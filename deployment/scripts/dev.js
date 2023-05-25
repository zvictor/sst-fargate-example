#!/usr/bin/env zx
cd(path.join(__dirname, '..'))
process.env.FORCE_COLOR = 1

class DevDeployment {
  constructor() {
    this.stage = argv['stage'] || process.env.USER || os.userInfo().username
    this.region = argv['region'] || 'us-east-2'

    this.color = [ 'red', 'blue', 'pink', 'yellow', 'brown', 'purple']
      .sort(() => Math.random() - 0.5)[0]
    this.coloredStage = `${this.stage.replaceAll('-', '_')}-${this.color}`
  }

  async deploy() {
    return Promise.all([
      this.copyEnvironment(),
      $`./node_modules/.bin/sst dev --stage '${this.coloredStage}' --region '${this.region}'`,
    ])
  }

  async copyEnvironment() {
    const env = await within(async () => {
      const log = $.log
      $.log = (entry) => {
        if (entry.kind === 'stdout') return

        return log(entry)
      }

      const proc =
        await $`./node_modules/.bin/sst secrets list env --stage '${this.stage}' --region '${this.region}'`

      return proc.exitCode === 0 && proc.stdout !== 'No secrets set\n' ? proc.stdout : null
    })

    if (!env) {
      throw new Error(`No secrets set for stage '${this.stage}' and region '${this.region}'`)
    }

    const envFile = `/tmp/${this.coloredStage}.env`
    fs.writeFileSync(envFile, env)

    await $`./node_modules/.bin/sst secrets load '${envFile}' --stage '${this.coloredStage}' --region '${this.region}'`
    fs.unlinkSync(envFile)
  }
}

new DevDeployment().deploy()
