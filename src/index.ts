/* eslint-disable @typescript-eslint/no-extraneous-class */
import { NgModule } from '@angular/core'
import { ToastrModule } from 'ngx-toastr'
import { TerminalDecorator } from 'tabby-terminal'

import { DevHelperDecorator } from './decorator'
import { StartupService } from './decorator/startup'

@NgModule({
    imports: [ToastrModule],
    providers: [
        {
            provide: TerminalDecorator,
            useClass: DevHelperDecorator,
            multi: true,
        },
        StartupService,
    ],
})
export default class DevHelperModule {
    constructor(_startup: StartupService) { }
}
