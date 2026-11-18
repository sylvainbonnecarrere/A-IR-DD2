export function buildTestMongoUri(baseUri: string | undefined, dbName: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) {
        throw new Error('Invalid test database name');
    }

    if (!baseUri) {
        return `mongodb://localhost:27017/${dbName}`;
    }

    const match = /^(mongodb(?:\+srv)?:\/\/[^/?#]+)(?:\/[^?#]*)?(\?[^#]*)?$/.exec(baseUri);
    if (!match) {
        throw new Error('Invalid MongoDB URI for test database');
    }

    const authority = match[1].replace(/^mongodb(?:\+srv)?:\/\//, '');
    const hosts = authority.slice(authority.lastIndexOf('@') + 1).split(',');
    const isLoopback = (value: string) => {
        const host = value.startsWith('[')
            ? value.slice(1, value.indexOf(']'))
            : value.replace(/:\d+$/, '');
        if (host === 'localhost' || host === '::1') {
            return true;
        }
        const octets = host.split('.').map(Number);
        return octets.length === 4
            && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
            && octets[0] === 127;
    };
    if (hosts.length === 0 || hosts.some((host) => !isLoopback(host))) {
        throw new Error('MongoDB tests require a loopback-only server; refusing to use a shared database');
    }

    return `${match[1]}/${dbName}${match[2] ?? ''}`;
}
