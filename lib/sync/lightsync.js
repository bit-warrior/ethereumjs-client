'use strict'

const Synchronizer = require('./sync')
const HeaderFetcher = require('./headerfetcher')

/**
 * Implements an ethereum light sync synchronizer
 * @memberof module:sync
 */
class LightSynchronizer extends Synchronizer {
  /**
   * Create new node
   * @param {Object}      options constructor parameters
   * @param {PeerPool}    options.pool peer pool
   * @param {Chain}       options.chain blockchain
   * @param {FlowControl} options.flow flow control manager
   * @param {number}      [options.interval] refresh interval
   * @param {Logger}      [options.logger] Logger instance
   */
  constructor (options) {
    super(options)
    this.flow = options.flow
    this.headerFetcher = new HeaderFetcher({
      pool: this.pool,
      flow: this.flow,
      chain: this.chain,
      logger: this.logger
    })
    this.init()
  }

  init () {
    this.pool.on('message:les', (message, peer) => this.handle(message, peer))
    this.headerFetcher.on('error', (error, task, peer) => {
      this.logger.debug(`Error processing task ${JSON.stringify(task)} with peer ${peer}: ${error.stack}`)
    })
  }

  /**
   * Returns true if peer can be used to fetch headers
   * @return {boolean}
   */
  fetchable (peer) {
    return peer.les && peer.les.status.serveHeaders && !peer.inbound
  }

  /**
   * Returns synchronizer type
   * @return {string} type
   */
  get type () {
    return 'light'
  }

  /**
   * Find an origin peer that contains the highest total difficulty. We will
   * synchronize to this peer's blockchain. Returns a promise that resolves once
   * an origin peer is found.
   * @return {Promise} Resolves with [ origin peer, height ]
   */
  async origin () {
    let best
    let height
    while (!height && this.syncing) {
      await this.wait()
      const peers = this.pool.peers.filter(this.fetchable.bind(this))
      if (!peers.length) {
        continue
      }
      for (let peer of this.pool.peers) {
        const td = peer.les.status.headTd
        if ((!best && td.gte(this.chain.headers.td)) ||
            (best && best.les.status.headTd.lt(td))) {
          best = peer
        }
      }
      if (best) {
        height = best.les.status.headNum
      }
    }
    return [best, height]
  }

  /**
   * Fetch all headers from current height up to specified number (last). Returns
   * a promise that resolves once all headers are downloaded.
   * @param  {BN} [last] number of last block header to download. If last is not
   * specified, the best height will be used from existing peers.
   * @return {Promise} Resolves with count of number of headers fetched
   */
  async fetch (last) {
    if (!last) {
      const [ origin, height ] = await this.origin()
      if (!origin || !height) {
        return 0
      }
      this.logger.info(`Using origin peer: ${origin.toString(true)} height=${height.toString(10)}`)
      last = height
    }

    const first = this.chain.headers.height.addn(1)

    if (first.gt(last)) {
      return 0
    }

    await this.headerFetcher.open()
    this.headerFetcher.add({ first, last })
    await this.headerFetcher.start()
    return last.sub(first).toNumber() + 1
  }

  /**
   * Handler for incoming requests from connected peers
   * @param  {Object}  message message object
   * @param  {Peer}    peer peer
   * @return {Promise}
   */
  async handle (message, peer) {
    try {
      if (!this.chain.opened) {
        await this.chain.open()
      }

      if (message.name === 'Announce') {
        const { headNumber, reorgDepth } = message.data
        // TO DO: handle re-orgs
        if (reorgDepth) {
          return
        }
        this.sync(headNumber)
      }
    } catch (error) {
      this.emit('error', error)
    }
  }

  /**
   * Open synchronizer. Must be called before sync() is called
   * @return {Promise}
   */
  async open () {
    await this.chain.open()
    await this.pool.open()
    const number = this.chain.headers.height.toString(10)
    const td = this.chain.headers.td.toString(10)
    const hash = this.chain.headers.latest.hash().toString('hex').slice(0, 8) + '...'
    this.logger.info(`Latest local header: number=${number} td=${td} hash=${hash}`)
  }

  /**
   * Stop synchronization. Returns a promise that resolves once its stopped.
   * @return {Promise}
   */
  async stop () {
    if (!this.syncing) {
      return false
    }
    await this.headerFetcher.stop()
    return super.stop()
  }
}

module.exports = LightSynchronizer
