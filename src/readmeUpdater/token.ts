    export function replaceVersionToken(
        original: string,
        version: string
    ): { updated: string; changed: boolean; fromToken: string | null; toToken: string } {
        // Find first occurrence like ${V12} and replace ALL occurrences to ${V<version>}
        const tokenRe = /\$\{V(\d+(?:\.\d+)?)\}/g;

        let firstFrom: string | null = null;
        const updated = original.replace(tokenRe, (m) => {
            if (!firstFrom) firstFrom = m;
            return `\${V${version}}`;
        });

        const changed = updated !== original;
        return { updated, changed, fromToken: firstFrom, toToken: `\${V${version}}` };
    }

