
export function handleSSHDisconnect(
    session: any // SSHShellSession
) {
    session.shell.closed$.subscribe(() => {
        session.logger.info('Shell session ended')
        if (session.open) {
            session.destroy()
        }
    })
}
