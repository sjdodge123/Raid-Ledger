import { useAuth } from '../../hooks/use-auth';
import { useMyCharacters } from '../../hooks/use-characters';
import { IntegrationHub } from '../../components/profile/IntegrationHub';

export function IdentityPanel() {
    const { user, isAuthenticated, refetch } = useAuth();
    const { data: charactersData } = useMyCharacters(undefined, isAuthenticated);

    if (!user) return null;

    const characters = charactersData?.data ?? [];

    return (
        <div className="space-y-6">
            <IntegrationHub user={user} characters={characters} onRefresh={refetch} />
        </div>
    );
}
