import { Injectable } from '@angular/core'
import {
    TerminalDecorator,
    BaseTerminalTabComponent,
    XTermFrontend,
} from 'tabby-terminal'
import {
    AppService,
    NotificationsService,
    PlatformService,
    TranslateService,
} from 'tabby-core'
import { SSHTabComponent } from 'tabby-ssh'
import { TerminalTabComponent } from 'tabby-local'
import slugify from 'slugify'
import { registerOscHandlers } from './decorator/osc-handlers'

@Injectable()
export class DevHelperDecorator extends TerminalDecorator {
    constructor(
        public app: AppService,
        public platform: PlatformService,
        public notifications: NotificationsService,
        public translate: TranslateService,
    ) {
        super()
    }

    private isWSLSession(tab: TerminalTabComponent): boolean {
        const profile = tab.profile
        const name1 = /^WSL \/ ([\w-.]+)$/im.exec(profile.name)
        const name2 = /^local:wsl-([\w-.]+)$/im.exec(profile.id)
        return (
            name1 !== null &&
            name2 !== null &&
            slugify(name1[1], { remove: /[:.]/g }) == name2[1]
        )
    }

    attach(tab: BaseTerminalTabComponent<any>): void {
        if (!(tab.frontend instanceof XTermFrontend)) {
            return
        }

        if (!(
            tab instanceof SSHTabComponent ||
            (tab instanceof TerminalTabComponent && this.isWSLSession(tab))
        )) {
            return
        }

        registerOscHandlers(tab, this)
    }
}
