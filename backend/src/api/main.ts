import { assertApiConfig, assertConfig, config } from '../config.ts'
import { buildServer } from './server.ts'

assertConfig()
assertApiConfig()
const app = await buildServer()

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
