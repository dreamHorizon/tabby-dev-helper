import * as keytar from 'keytar'
import colors from "ansi-colors";
import { BaseTerminalTabComponent, SessionMiddleware } from "tabby-terminal";
import { PasswordStorageService, SSHProfile, SSHTabComponent } from "tabby-ssh";
import { TerminalTabComponent } from "tabby-local";
import { NgbModal } from "@ng-bootstrap/ng-bootstrap";
import slugify from "slugify";
import { PromptModalComponent, VaultService } from "tabby-core";
import { DevHelperDecorator } from 'decorator';

export const VAULT_SECRET_TYPE_PASSWORD = 'ssh:password'

async function loadPasswordSSH(vault: VaultService, user: string, host: string, port: number): Promise<string | null> {
    if (vault.isEnabled()) {
        const key = { user, host, port }
        return (await vault.getSecret(VAULT_SECRET_TYPE_PASSWORD, key))?.value ?? null
    } else {
        const key = `ssh@${host}:${port}`
        return keytar.getPassword(key, user)
    }
}

async function loadPasswordWSL(vault: VaultService, distribution: string): Promise<string | null> {
    if (vault.isEnabled()) {
        const key = { distribution }
        return (await vault.getSecret(VAULT_SECRET_TYPE_PASSWORD, key))?.value ?? null
    } else {
        const key = `wsl@${distribution}`
        return keytar.getPassword(key, 'default')
    }
}

async function savePasswordWSL(vault: VaultService, distribution: string, password: string): Promise<void> {
    if (vault.isEnabled()) {
        const key = { distribution }
        vault.addSecret({ type: VAULT_SECRET_TYPE_PASSWORD, key, value: password })
    } else {
        const key = `wsl@${distribution}`
        await keytar.setPassword(key, 'default', password)
    }
}

// 优化后的正则表达式：使用肯定预查验证行尾特征，避免不定长匹配
const SUDO_PROMPT_REGEX = /(?:^|[\r\n])\[sudo\] password for ([^:]{1,10}):\s*$/i;
const SSH_PROMPT_REGEX = /(?:^|[\r\n])([\w-]{1,10})@([\w-.]+)(?='s password:\s*$)/i;
const SUDO_RS_PROMPT_REGEX =
    /(?:^|\r\n)(?:\[sudo: authenticate\] )?(?=Password:\s*$)/i;

class WSLSudoPasswordMiddleware extends SessionMiddleware {
    private pendingPasswordToPaste: string | null = null;
    private pasteHint = `${colors.black.bgBlackBright(" Tabby ")} ${colors.gray("Press Enter to paste saved password")}`;
    private pasteHintLength = colors.stripColor(this.pasteHint).length;

    constructor(
        private distributionName: string,
        private ps: PasswordStorageService,
    ) {
        super();
    }

    feedFromSession(data: Buffer): void {
        const text = data.toString("utf-8");

        const match = SUDO_PROMPT_REGEX.exec(text);
        if (match) {
            this.handleWSLPrompt();
        } else {
            const rustMatch = SUDO_RS_PROMPT_REGEX.exec(text);
            if (rustMatch) {
                this.handleWSLPrompt();
            }
        }
        this.outputToTerminal.next(data);
    }

    feedFromTerminal(data: Buffer): void {
        if (this.pendingPasswordToPaste) {
            const backspaces = Buffer.alloc(this.pasteHintLength, 8); // backspace
            const spaces = Buffer.alloc(this.pasteHintLength, 32); // space
            const clear = Buffer.concat([backspaces, spaces, backspaces]);
            this.outputToTerminal.next(clear);
            if (data.length === 1 && data[0] === 13) {
                // Enter key
                this.outputToSession.next(
                    Buffer.from(this.pendingPasswordToPaste + "\n"),
                );
                this.pendingPasswordToPaste = null;
                return;
            } else {
                this.pendingPasswordToPaste = null;
            }
        }
        this.outputToSession.next(data);
    }

    async handleWSLPrompt(): Promise<void> {
        console.log(
            `Detected wsl prompt for distribution: ${this.distributionName}`,
        );
        const pw = await loadPasswordWSL(this.ps['vault'], this.distributionName);
        if (pw) {
            this.outputToTerminal.next(Buffer.from(this.pasteHint));
            this.pendingPasswordToPaste = pw;
        }
    }
}

class SSHSudoPasswordMiddleware extends SessionMiddleware {
    private pendingPasswordToPaste: string | null = null;
    private pasteHint = `${colors.black.bgBlackBright(" Tabby ")} ${colors.gray("Press Enter to paste saved password")}`;
    private pasteHintLength = colors.stripColor(this.pasteHint).length;

    constructor(
        private profile: SSHProfile,
        private ps: PasswordStorageService,
    ) {
        super();
    }

    feedFromSession(data: Buffer): void {
        const text = data.toString("utf-8");
        const match = SUDO_PROMPT_REGEX.exec(text);
        if (match) {
            const username = match[1];
            this.handlePrompt(username);
        } else {
            const rustMatch = SUDO_RS_PROMPT_REGEX.exec(text);
            if (rustMatch) {
                // Rust sudo prompt does not contain username, assume current profile user
                const username = this.profile.options.user;
                this.handlePrompt(username);
            } else {
                const match = SSH_PROMPT_REGEX.exec(text);
                if (match) {
                    const username = match[1];
                    const host = match[2];
                    this.handleSSHPrompt(username, host);
                }
            }
        }
        this.outputToTerminal.next(data);
    }

    feedFromTerminal(data: Buffer): void {
        if (this.pendingPasswordToPaste) {
            const backspaces = Buffer.alloc(this.pasteHintLength, 8); // backspace
            const spaces = Buffer.alloc(this.pasteHintLength, 32); // space
            const clear = Buffer.concat([backspaces, spaces, backspaces]);
            this.outputToTerminal.next(clear);
            if (data.length === 1 && data[0] === 13) {
                // Enter key
                this.outputToSession.next(
                    Buffer.from(this.pendingPasswordToPaste + "\n"),
                );
                this.pendingPasswordToPaste = null;
                return;
            } else {
                this.pendingPasswordToPaste = null;
            }
        }
        this.outputToSession.next(data);
    }

    async handlePrompt(username: string): Promise<void> {
        console.log(`Detected sudo prompt for user: ${username}`);
        const pw = await this.ps.loadPassword(this.profile, username);
        if (pw) {
            this.outputToTerminal.next(Buffer.from(this.pasteHint));
            this.pendingPasswordToPaste = pw;
        }
    }

    async handleSSHPrompt(username: string, host: string): Promise<void> {
        console.log(`Detected ssh prompt for user: ${username}`);
        const pw = await loadPasswordSSH(this.ps['vault'], username, host, 22);
        if (pw) {
            this.outputToTerminal.next(Buffer.from(this.pasteHint));
            this.pendingPasswordToPaste = pw;
        }
    }
}

function getWSLDistributionName(tab: TerminalTabComponent): string | null {
    const profile = tab.profile;
    const name1 = /^WSL \/ ([\w-.]+)$/im.exec(profile.name);
    const name2 = /^local:wsl-([\w-.]+)$/im.exec(profile.id);
    if (
        name1 !== null &&
        name2 !== null &&
        slugify(name1[1], { remove: /[:.]/g }) == name2[1]
    ) {
        return name2[1];
    }
    return null;
}

async function promptAndSaveWSLPassword(
    distribution: string,
    ps: PasswordStorageService,
    ngbModal: NgbModal,
): Promise<void> {
    const modal = ngbModal.open(PromptModalComponent);
    modal.componentInstance.prompt = `Password for WSL distribution: ${distribution}`;
    modal.componentInstance.password = true;
    modal.componentInstance.showRememberCheckbox = true;
    modal.componentInstance.remember = true;

    try {
        const promptResult = await modal.result.catch(() => null);
        if (promptResult && promptResult.value) {
            await savePasswordWSL(ps['vault'], distribution, promptResult.value);
        }
    } catch {
        // User cancelled, do nothing
    }
}

export function applySudoPasswordMiddleWare(
    tab: BaseTerminalTabComponent<any>,
    helper: DevHelperDecorator,
) {
    if (!tab.session) {
        return
    }
    const isSSH = tab instanceof SSHTabComponent;
    const distribution = getWSLDistributionName(tab as TerminalTabComponent);

    if (distribution !== null) {
        loadPasswordWSL(helper.ps['vault'], distribution).then((pw: any) => {
            if (!pw) {
                promptAndSaveWSLPassword(distribution, helper.ps, helper.ngbModal);
            }
        });
        tab.session.middleware.unshift(
            new WSLSudoPasswordMiddleware(distribution, helper.ps),
        );
        return;
    }
    if (isSSH) {
        tab.session.middleware.unshift(
            new SSHSudoPasswordMiddleware(tab.profile, helper.ps),
        );
    }
}
