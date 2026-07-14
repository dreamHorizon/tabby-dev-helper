import { DevHelperDecorator } from 'decorator'
import { BaseTerminalTabComponent, XTermFrontend } from 'tabby-terminal'

export function registerOscHandlers(
    tab: BaseTerminalTabComponent<any>,
    helper: DevHelperDecorator,
) {
    if (tab.session) {
        tab.session.middleware.remove(tab.session.oscProcessor)
    }

    const xterm = (tab.frontend as XTermFrontend).xterm
    xterm.parser.registerOscHandler(9, (data: string) => {
        new Notification('Terminal Message', {
            body: data,
        }).addEventListener('click', () => {
            helper.app.selectTab(tab)
        })
        return true
    })
    xterm.parser.registerOscHandler(52, (data: string) => {
        const oscParams = data.split(';')
        const content = Buffer.from(oscParams[1], 'base64').toString()
        if (oscParams[0] === 'c') {
            helper.platform.setClipboard({ text: content })
            helper.notifications.notice(helper.translate.instant('Copied'))
            return true
        }
        return false
    })
    xterm.parser.registerOscHandler(777, (data: string) => {
        const oscParams = data.split(';')
        if (oscParams[0] === 'notify') {
            new Notification(oscParams[1], {
                body: oscParams[2],
            }).addEventListener('click', () => {
                helper.app.selectTab(tab)
            })
            return true
        }
        return false
    })
}
