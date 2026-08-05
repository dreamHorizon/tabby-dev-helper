import { BaseTerminalTabComponent, OSCProcessor, SessionMiddleware } from 'tabby-terminal'
import stripAnsi from 'strip-ansi'
import { Subject } from 'rxjs'
import { BaseTabProcess } from 'tabby-core'
import { TerminalTabComponent } from 'tabby-local'

type Expose<T, U extends Record<string, any> = {}> = {
    [K in keyof T]: T[K]
} & Omit<U, keyof T> &
    Pick<U, Extract<keyof U, keyof T>>

// 暴露私有属性 有类型提示
type OSCProcessorPatched = Expose<OSCProcessor, {
    cwdReported: Subject<string>
}>

declare module 'tabby-terminal' {
    interface OSCProcessor {
        // 新增属性方法
        _regex: RegExp
        _blocked: boolean
    }
}

const DEFAULT_REGEX = /^(?<user>[\w-]{1,10})@(?<host>[\w-]+)[\s:](?<cwd>[/~][\w\-\./]*)\s?[$#]/m

export function patchOSCProcessor() {
    const Proto = OSCProcessor.prototype as unknown as OSCProcessorPatched

    Object.defineProperty(Proto, '_regex', { value: DEFAULT_REGEX, writable: true, configurable: true })
    Object.defineProperty(Proto, '_blocked', { value: true, writable: true, configurable: true })

    Proto.feedFromSession = function (this: OSCProcessorPatched, data: Buffer): void {
        do {
            let str = data.toString('utf-8').replace(/(\x1b]0;[^\x07]*\x07)/g, '')
            str = stripAnsi(str).trim()
            let match = str.match(this._regex)
            if (!match) break
            this._blocked = false
            if (!(match.groups?.user && match.groups.cwd)) break
            if (match.groups.user !== 'root') {
                this.cwdReported.next(match.groups.cwd.replace(/^~(?=\/|$)/, '/home/' + match.groups.user))
            } else {
                this.cwdReported.next(match.groups.cwd.replace(/^~(?=\/|$)/, '/root'))
            }
        } while (0)
        SessionMiddleware.prototype.feedFromSession.call(this, data)
    }

    Proto.feedFromTerminal = function (this: OSCProcessorPatched, data: Buffer): void {
        this._blocked = true
        SessionMiddleware.prototype.feedFromTerminal.call(this, data)
    }

    const originalGetCurrentProcess = TerminalTabComponent.prototype.getCurrentProcess

    TerminalTabComponent.prototype.getCurrentProcess = async function (): Promise<BaseTabProcess | null> {
        if (this.profile.options.command.endsWith('wsl.exe')) {
            return BaseTerminalTabComponent.prototype.getCurrentProcess.call(this)
        }
        return originalGetCurrentProcess.call(this)
    }
    BaseTerminalTabComponent.prototype.getCurrentProcess = async function (): Promise<BaseTabProcess | null> {
        if (this.session?.oscProcessor._blocked) {
            return {
                name: 'wait for prompt',
            }
        } else {
            return null
        }
    }
}
