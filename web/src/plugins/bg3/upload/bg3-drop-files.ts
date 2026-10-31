/**
 * ROK-1960 L3 — what a drop onto the upload zone holds: a single dropped
 * folder is read one level deep (its name keys the campaign, CONTRACT §3.3);
 * anything else is the bare file list with no folder name. Which `.lsv` to
 * read is `selectBg3SaveSource`'s call, not this one.
 */

export interface Bg3DroppedFiles {
    readonly files: readonly File[];
    readonly folderName: string | null;
}

const isDirectory = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry => entry.isDirectory;
const isFile = (entry: FileSystemEntry): entry is FileSystemFileEntry => entry.isFile;

/** `readEntries` hands back batches until an empty one. */
async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    const all: FileSystemEntry[] = [];
    for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) return all;
        all.push(...batch);
    }
}

const fileOf = (entry: FileSystemFileEntry): Promise<File> =>
    new Promise((resolve, reject) => entry.file(resolve, reject));

function entriesOf(dt: DataTransfer): FileSystemEntry[] {
    // jsdom and some browsers hand over no `items`; fall back to `files` then.
    const items: DataTransferItemList | undefined = dt.items;
    if (!items) return [];
    return Array.from(items, (item) => item.webkitGetAsEntry()).filter((e): e is FileSystemEntry => e !== null);
}

export async function readDroppedFiles(dt: DataTransfer): Promise<Bg3DroppedFiles> {
    const entries = entriesOf(dt);
    const [only] = entries;
    if (entries.length === 1 && only && isDirectory(only)) {
        const children = await readAllEntries(only.createReader());
        return { files: await Promise.all(children.filter(isFile).map(fileOf)), folderName: only.name };
    }
    return { files: Array.from(dt.files), folderName: null };
}
