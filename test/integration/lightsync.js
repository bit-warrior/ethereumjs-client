'use strict'

const tape = require('tape')
const { EthereumService } = require('../../lib/service')
const MockServer = require('./mocks/mockserver.js')
const MockChain = require('./mocks/mockchain.js')
const { defaultLogger } = require('../../lib/logging')
defaultLogger.silent = true

tape('[Integration:LightSync]', async (t) => {
  async function setup (options = {}) {
    const server = new MockServer({location: options.location})
    const chain = new MockChain({height: options.height})
    const service = new EthereumService({
      servers: [ server ],
      syncmode: options.syncmode,
      lightserv: true,
      interval: options.interval || 10,
      chain
    })
    await service.open()
    await server.start()
    await service.start()
    return [server, service]
  }

  async function destroy (server, service) {
    await service.stop()
    await server.stop()
    await service.close()
  }

  t.test('should sync headers', async (t) => {
    const [remoteServer, remoteService] = await setup({location: '127.0.0.2', height: 10, syncmode: 'fast'})
    const [localServer, localService] = await setup({location: '127.0.0.1', height: 0, syncmode: 'light'})
    localService.on('synchronized', async (stats) => {
      t.equal(stats.count, 10, 'synced')
      await destroy(localServer, localService)
      await destroy(remoteServer, remoteService)
      t.end()
    })
    localServer.discover('remotePeer', '127.0.0.2')
  })

  t.test('should not sync with stale peers', async (t) => {
    const [remoteServer, remoteService] = await setup({location: '127.0.0.2', height: 9, syncmode: 'fast'})
    const [localServer, localService] = await setup({location: '127.0.0.1', height: 10, syncmode: 'light'})
    localService.on('synchronized', async (stats) => {
      t.equal(stats.count, 0, 'nothing synced')
      await destroy(remoteServer, remoteService)
      t.end()
    })
    localServer.discover('remotePeer', '127.0.0.2')
    setTimeout(async () => {
      await destroy(localServer, localService)
    }, 100)
  })

  t.test('should find best origin peer', async (t) => {
    const [remoteServer1, remoteService1] = await setup({location: '127.0.0.2', height: 9, syncmode: 'fast'})
    const [remoteServer2, remoteService2] = await setup({location: '127.0.0.3', height: 10, syncmode: 'fast'})
    const [localServer, localService] = await setup({location: '127.0.0.1', height: 0, syncmode: 'light'})
    await localService.synchronizer.stop()
    await localServer.discover('remotePeer1', '127.0.0.2')
    await localServer.discover('remotePeer2', '127.0.0.3')
    localService.on('synchronized', async (stats) => {
      t.equal(stats.count, 10, 'synced with best peer')
      await destroy(localServer, localService)
      await destroy(remoteServer1, remoteService1)
      await destroy(remoteServer2, remoteService2)
      t.end()
    })
    localService.synchronizer.sync()
  })
})
