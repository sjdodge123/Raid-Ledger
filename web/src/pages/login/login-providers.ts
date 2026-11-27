/** ROK-2371: login-method helpers for the provider buttons. */
import type { LoginMethodDto } from '@raid-ledger/contract';

export function isGoogleMethod(p: LoginMethodDto): boolean {
    return p.key === 'google' || p.icon === 'google';
}

/** Split the server's login methods into top-level and "Try another way" ones. */
export function splitByPlacement(providers: LoginMethodDto[]): { primary: LoginMethodDto[]; alternate: LoginMethodDto[] } {
    return {
        primary: providers.filter((p) => p.placement !== 'alternate'),
        alternate: providers.filter((p) => p.placement === 'alternate'),
    };
}
