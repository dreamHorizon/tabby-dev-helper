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
import { PasswordStorageService, SSHTabComponent } from 'tabby-ssh'
import { TerminalTabComponent } from 'tabby-local'
import slugify from 'slugify'
import { registerOscHandlers } from './decorator/osc-handlers'
import { applySudoPasswordMiddleWare } from "./decorator/sudoPasswordMiddleware";
import { NgbModal } from "@ng-bootstrap/ng-bootstrap";

@Injectable()
export class DevHelperDecorator extends TerminalDecorator {
    constructor(
        public app: AppService,
        public platform: PlatformService,
        public notifications: NotificationsService,
        public translate: TranslateService,
        public ps: PasswordStorageService,
        public ngbModal: NgbModal,
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

    private attachToSession(tab: BaseTerminalTabComponent<any>) {
        if (!tab.session) {
            return
        }
        applySudoPasswordMiddleWare(tab, this);
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
        setTimeout(() => {
            this.attachToSession(tab);
            this.subscribeUntilDetached(
                tab,
                tab.sessionChanged$.subscribe(() => {
                    this.attachToSession(tab);
                }),
            );
        });
    }
}
