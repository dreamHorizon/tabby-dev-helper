import { Inject, Injectable, Optional } from "@angular/core"
import { AppService, HostWindowService } from "tabby-core"
import { Shell, ShellProvider } from "tabby-local"
import { BaseTerminalTabComponent } from "tabby-terminal"
import { patchOSCProcessor } from "./cwdParser"

@Injectable()
export class StartupService {
    constructor(
        app: AppService,
        private hostWindow: HostWindowService,
        @Inject(ShellProvider) @Optional() private shellProviders?: ShellProvider[],
    ) {
        app.ready$.subscribe(() => {
            this.patchTabFocus()
            this.patchWslCwd()
            this.patchMouseEvents()
            patchOSCProcessor()
        })
    }

    private patchTabFocus() {
        const hw = this.hostWindow
        const originalSelectTab = AppService.prototype.selectTab
        AppService.prototype.selectTab = function (
            tab: BaseTerminalTabComponent<any>,
            ...rest: any[]
        ) {
            hw.bringToFront()
            return originalSelectTab.call(this, tab.topmostParent ?? tab, ...rest)
        }
    }

    private patchWslCwd() {
        const wsl = this.shellProviders?.find(p => p.constructor.name === 'WSLShellProvider')
        if (!wsl) return

        const originalProvide = wsl.constructor.prototype.provide
        wsl.constructor.prototype.provide = function () {
            return originalProvide.call(this).then((results: Shell[]) => {
                for (const res of results) {
                    if (res.args) {
                        res.args.push('--cd', '~')
                    } else {
                        res.args = ['--cd', '~']
                    }
                }
                return results
            })
        }
    }

    private patchMouseEvents() {
        const originalAttach = BaseTerminalTabComponent.prototype.attachTermContainerHandlers
        BaseTerminalTabComponent.prototype.attachTermContainerHandlers = function () {
            originalAttach.call(this)

            this['termContainerSubscriptions']['subscriptions'][3].unsubscribe()
            this['termContainerSubscriptions'].subscribe(this.frontend.mouseEvent$, (event: MouseEvent) => {
                if (event.type === 'mousedown') {
                    if (event.which === 1) {
                        this.multifocus.cancel()
                    }
                    if (event.which === 3) {
                        this.handleRightMouseDown(event)
                        return
                    }
                }
                if (event.type === 'mouseup') {
                    if (event.which === 3) {
                        this.handleRightMouseUp(event)
                        return
                    }
                }
            })
        }
    }
}
