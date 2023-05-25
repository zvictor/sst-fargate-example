import pm2 from 'pm2'
import path from 'node:path'
import chokidar from 'chokidar'
import * as cdk from 'aws-cdk-lib'
import pDebounce from 'p-debounce'
import { Config } from 'sst/config.js'
import { promisify } from 'node:util'
import { useProject } from 'sst/project.js'
import { useAWSCredentials } from 'sst/credentials.js'

const singleError =
  <T extends (...args: Parameters<T>) => ReturnType<T>>(fn: T) =>
  (...args: Parameters<T>): Promise<ReturnType<T>> =>
    Promise.resolve(fn(...args)).catch((error) => {
      if (Array.isArray(error)) {
        throw error[0]
      }

      throw error
    })

const pm2Connect = singleError(promisify(pm2.connect.bind(pm2)))
const pm2Disconnect = singleError(promisify(pm2.disconnect.bind(pm2)))
const pm2Start = singleError(
  promisify(pm2.start.bind(pm2)) as (options: pm2.StartOptions) => Promise<void>
)
const pm2Stop = singleError(promisify(pm2.stop.bind(pm2)))
const pm2Delete = singleError(promisify(pm2.delete.bind(pm2)))
const pm2Describe = singleError(promisify(pm2.describe.bind(pm2)))

const sstEnv = async () => {
  // Based on https://github.com/serverless-stack/sst/blob/9beac5e4184bd90fb825f09a5a75ceea50dd3d2e/packages/sst/src/cli/commands/bind.ts#L18-L37
  const project = useProject()
  const credentials = await useAWSCredentials()

  return {
    AWS_ACCESS_KEY_ID: credentials.accessKeyId!,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey!,
    AWS_SESSION_TOKEN: credentials.sessionToken!,
    AWS_REGION: project.config.region!,
  }
}

export class LocalContainer {
  private readonly stack: cdk.Stack
  private readonly options: pm2.StartOptions = {}
  private readonly bindings: string[] = []

  constructor(stack: cdk.Stack, options: pm2.StartOptions) {
    this.stack = stack
    this.options = options
    this.restart = pDebounce(this.restart, 3000)

    this.watch()
    setInterval(() => this.checkBindings(), 10000)
  }

  public async isRunning() {
    await pm2Connect()

    const proc = (await pm2Describe(this.stack.node.id))[0]
    return Boolean(proc?.pid)
  }

  public async remove() {
    try {
      if (!(await this.isRunning())) {
        console.log(`Process ${this.stack.node.id} does not exist`)
        return null
      }

      return await pm2Delete(this.stack.node.id)
    } catch (err1) {
      console.error(`Error deleting ${this.stack.node.id}`, err1)
      console.log(`Stopping ${this.stack.node.id}...`)

      try {
        return await pm2Stop(this.stack.node.id)
      } catch (error) {
        console.error(`Error stopping ${this.stack.node.id}`)
      }
    }

    return null
  }

  public async start() {
    try {
      await pm2Connect()

      if (!this.stack.node.id) {
        throw new Error('No node id found')
      }

      return await pm2Start({
        name: this.stack.node.id,
        source_map_support: true,
        autorestart: true,
        watch: false,
        interpreter: 'node',
        interpreter_args: ['--loader', 'ts-node/esm'],
        exp_backoff_restart_delay: 1000,
        ...this.options,
        env: { ...(await sstEnv()), ...this.options.env },
      })
    } finally {
      await pm2Disconnect()
    }
  }

  private async restart() {
    if (this.stack.node.scope?.mode === 'remove') {
      return null
    }

    if (!(await this.isRunning())) {
      return null
    }

    console.log(`Restarting ${this.stack.node.id} (pm2)...`)
    await this.remove()
    return await this.start()
  }

  public async run() {
    if (this.stack.node.scope?.mode === 'remove') {
      try {
        return await this.remove()
      } catch (error) {
        console.error(error)
      }
    }

    return await this.start()
  }

  private watch() {
    if (this.stack.node.scope?.mode === 'remove') {
      return
    }

    const watchPath = path.join(process.cwd(), this.options.cwd || '.')
    const watcher = chokidar.watch(watchPath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
    })

    watcher.on('change', async (path) => {
      console.log(`Change detected at ${path}`)
      await this.restart()
    })
  }

  private async checkBindings() {
    this.options.env = this.options.env || {}

    const env = await Config.env()
    let changed = false

    for (const key of this.bindings) {
      if (this.options.env[key] === env[key]) {
        continue
      }

      changed = true
      this.options.env[key] = env[key]
    }

    if (changed) {
      await this.restart()
    }
  }

  addEnvironment(key: string, value: string) {
    this.bindings.push(key)
    return this.checkBindings()
  }
}

export default class LocalServiceStack extends cdk.Stack {
  public readonly container: LocalContainer

  constructor(scope: cdk.App, id: string, options: pm2.StartOptions, props?: cdk.StackProps) {
    super(scope, id, props)
    this.container = new LocalContainer(this, options)
  }
}
