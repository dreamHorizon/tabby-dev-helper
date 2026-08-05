import { SSHSession, SSHTabComponent } from 'tabby-ssh'
import { handleSSHDisconnect } from './sshDisconnect'

type Expose<T, U extends Record<string, any> = {}> = {
    [K in keyof T]: T[K]
} & Omit<U, keyof T> &
    Pick<U, Extract<keyof U, keyof T>>

type SSHTabComponentPatched = Expose<SSHTabComponent, {
    sshSession: SSHSession & { _tabs: SSHTabComponent[] }
}>

declare module 'tabby-ssh' {
    interface SSHSession {
        _tabs: SSHTabComponent[]
    }
}

function _injectWinSCPButton(sshTab: SSHTabComponentPatched) {
    const toolbar = sshTab.element.nativeElement.querySelector('terminal-toolbar .content')
    if (!toolbar) return

    if (toolbar.getElementsByClassName('winscp-btn').length) return
    const portBtn = toolbar.querySelector('button:has(.fa-plug)')
    if (!portBtn) {
        setTimeout(function () { _injectWinSCPButton(sshTab) }, 100)
        return
    }

    const btn = document.createElement('button')
    btn.className = 'btn btn-sm btn-link me-2 winscp-btn'
    btn.innerHTML = '<i class="fas fa-external-link-alt"></i><span>WinSCP</span>'
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        (sshTab as any).ssh.launchWinSCP(sshTab.sshSession)
    })
    portBtn.parentElement?.insertBefore(btn, portBtn)
}

function _patchSSHService(ssh) {
    ssh.launchWinSCP = async function (session: SSHSession): Promise<void> {
        const path = this.getWinSCPPath()
        if (!path) {
            return
        }
        let cwd, title
        for (const tab of session._tabs) {
            if (tab.hasFocus) {
                cwd = await tab.session?.getWorkingDirectory()
                title = tab.title
                break
            }
        }
        const winscpParms = await this.getWinSCPURI(session.profile, cwd, session.authUsername ?? undefined)
        const args = [winscpParms.uri + '/']
        console.warn(cwd, args)

        let tmpFile: any = null
        try {
            if (session.activePrivateKey && session.profile.options.privateKeys && session.profile.options.privateKeys.length > 0) {
                const profile = session.profile
                const privateKeyPairs = await this.convertPrivateKeyFileToPuTTYFormat(profile)
                tmpFile = privateKeyPairs.privateKeyFile
                if (tmpFile) {
                    args.push(`/privatekey=${tmpFile.path}`)
                }
                if (privateKeyPairs.passphrase != null) {
                    args.push(`/passphrase=${privateKeyPairs.passphrase}`)
                }
            }
            args.push(`/sessionname=${title}`)
            await this.platform.exec(path, args)
        } finally {
            tmpFile?.cleanup()
            winscpParms.privateKeyFile?.cleanup()
        }
    }
}

export function patchSSHTabComponent() {
    const Proto = SSHTabComponent.prototype as unknown as SSHTabComponentPatched

    const originalInitializeSessionMaybeMultiplex = Proto.initializeSessionMaybeMultiplex

    Proto.initializeSessionMaybeMultiplex = async function (this: SSHTabComponentPatched, multiplex = true) {
        await originalInitializeSessionMaybeMultiplex.call(this, multiplex)
        _patchSSHService((this as any).ssh)
        if (this.sshSession) {
            this.sshSession._tabs = this.sshSession._tabs || []
            this.sshSession._tabs.push(this)
        }
        _injectWinSCPButton(this)
        handleSSHDisconnect(this.session)
    }

    const originalDestroy = Proto.destroy

    Proto.destroy = async function (this: SSHTabComponentPatched) {
        if (this.sshSession?._tabs) {
            const idx = this.sshSession._tabs.indexOf(this)
            if (idx !== -1) {
                this.sshSession._tabs.splice(idx, 1)
            }
        }
        return originalDestroy.call(this)
    }
}
