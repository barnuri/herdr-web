import { useState } from 'react';
import type { NotificationSettingsHelp } from '../lib/notifications';

interface NotificationHelpProps {
    readonly help: NotificationSettingsHelp | null;
    readonly onClose: () => void;
}

// shown when the notification permission is blocked: a real path to the fix,
// not just a toast — Android gets a button that opens the OS settings
export function NotificationHelp({ help, onClose }: NotificationHelpProps) {
    const [copied, setCopied] = useState(false);
    if (!help) {
        return null;
    }

    const copyUrl = async (value?: string) => {
        if (!value) {
            return;
        }
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
        } catch {}
    };

    return (
        <div className="sheet-backdrop" role="presentation" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="Enable notifications" onClick={(e) => e.stopPropagation()}>
                <h2 className="sheet-title">{help.title}</h2>
                <ol className="sheet-steps">
                    {help.steps.map((step) => (
                        <li key={step}>{step}</li>
                    ))}
                </ol>
                {help.platform === 'android' && help.intentUrl && (
                    <a className="sheet-btn sheet-btn-primary" href={help.intentUrl}>
                        Open notification settings
                    </a>
                )}
                {help.platform === 'insecure' && help.httpsUrl && (
                    <a className="sheet-btn sheet-btn-primary" href={help.httpsUrl}>
                        Open the HTTPS version
                    </a>
                )}
                {help.certUrl && (
                    <a className="sheet-btn sheet-btn-primary" href={help.certUrl} download>
                        Download certificate
                    </a>
                )}
                {help.platform === 'desktop' && help.settingsUrl && (
                    <button type="button" className="sheet-btn sheet-btn-primary" onClick={() => void copyUrl(help.settingsUrl)}>
                        {copied ? 'Copied — paste it in a new tab' : `Copy ${help.settingsUrl}`}
                    </button>
                )}
                {help.platform === 'webview' && help.httpsUrl && (
                    <>
                        <button type="button" className="sheet-btn sheet-btn-primary" onClick={() => void copyUrl(help.httpsUrl)}>
                            {copied ? '已复制 — 粘贴到 Chrome 打开' : '复制页面地址'}
                        </button>
                        <p className="help-url">{help.httpsUrl}</p>
                    </>
                )}
                <button type="button" className="sheet-btn" onClick={onClose}>
                    Close
                </button>
            </div>
        </div>
    );
}
