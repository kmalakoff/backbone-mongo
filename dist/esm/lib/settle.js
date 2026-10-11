export function operationCallback(operation, callback) {
    // Notification is outside the Promise chain so a customer throw is not a driver rejection.
    void Promise.resolve().then(operation).then((value)=>queueMicrotask(()=>callback(null, value)), (error)=>queueMicrotask(()=>callback(error instanceof Error ? error : new Error('Mongo operation threw a non-Error value'))));
}
export function driverError(error, phase) {
    // Driver parse/transport messages can contain connection credentials.
    const safe = new Error(`Mongo ${phase} failed`);
    if (typeof error === 'object' && error !== null) {
        const code = Reflect.get(error, 'code');
        if (typeof code === 'number') Object.defineProperty(safe, 'code', {
            value: code,
            enumerable: true
        });
    }
    return safe;
}
