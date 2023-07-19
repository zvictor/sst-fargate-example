import { Construct } from 'constructs'
import { EdgeFunction } from 'sst/constructs/EdgeFunction.js'
import { SSTConstruct } from 'sst/constructs/Construct.js'

export default function CustomContruct<Base extends new (...args: any[]) => any>(Base: Base) {
  return class extends (Base || Construct) {
    bindingEnvs: Record<string, string>

    constructor(...args: any[]) {
      super(...args)

      this.bindingEnvs = {}
      // @ts-ignore
      this.bind = EdgeFunction.prototype.bind.bind(this)
      this.bind([])
    }

    public bind(constructs: SSTConstruct[]): void {
      throw new Error(`Not implemented`)
    }
  }
}
