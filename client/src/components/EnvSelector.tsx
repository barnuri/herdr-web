import { reachableEnvs, shouldShowSelector } from '../lib/envs';
import type { HerdrEnv } from '../lib/envs';

interface EnvSelectorProps {
    readonly envs: readonly HerdrEnv[];
    readonly value: string;
    readonly onChange: (id: string) => void;
}

/** Renders nothing unless more than one env is reachable. */
export function EnvSelector({ envs, value, onChange }: EnvSelectorProps) {
    if (!shouldShowSelector(envs)) {
        return null;
    }
    return (
        <label className="env-select">
            <span className="env-select-caption">env</span>
            <select
                className="env-select-input"
                aria-label="Herdr environment"
                title="Herdr environment"
                value={value}
                onChange={(event) => onChange(event.target.value)}
            >
                {reachableEnvs(envs).map((env) => (
                    <option key={env.id} value={env.id}>
                        {env.label}
                    </option>
                ))}
            </select>
        </label>
    );
}
