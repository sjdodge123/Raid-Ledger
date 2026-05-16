interface DrawerScreenshotsProps {
    screenshots: string[];
    gameName: string;
}

export function DrawerScreenshots({ screenshots, gameName }: DrawerScreenshotsProps) {
    if (!screenshots || screenshots.length === 0) {
        return (
            <div
                data-testid="game-research-drawer-screenshots"
                className="mt-4 text-sm text-muted"
            >
                No screenshots
            </div>
        );
    }
    return (
        <div
            data-testid="game-research-drawer-screenshots"
            className="mt-4 flex gap-2 overflow-x-auto pb-2"
            style={{ scrollbarWidth: 'none' }}
        >
            {screenshots.map((src) => (
                <img
                    key={src}
                    src={src}
                    alt={`${gameName} screenshot`}
                    className="h-32 w-auto flex-shrink-0 rounded-md object-cover"
                />
            ))}
        </div>
    );
}
