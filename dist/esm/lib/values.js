export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function copyValue(value) {
    if (Array.isArray(value)) return value.map(copyValue);
    if (value instanceof Date) return new Date(value.getTime());
    if (Buffer.isBuffer(value)) return Buffer.from(value);
    if (isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
        return Object.fromEntries(Object.entries(value).map(([key, entry])=>[
                key,
                copyValue(entry)
            ]));
    }
    return value;
}
export function stringList(value, label) {
    const values = Array.isArray(value) ? value : [
        value
    ];
    if (!values.every((entry)=>typeof entry === 'string')) throw new Error(`${label} requires strings`);
    return values;
}
export function nonnegativeInteger(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} requires a nonnegative integer`);
    return value;
}
