const winston = require('winston');
const EventEmitter = require('events');
const Transport = require('winston-transport');

const logStream = new EventEmitter();

class StreamTransport extends Transport {
    constructor(opts) {
        super(opts);
    }

    log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        // Emit to our SSE stream
        logStream.emit('log', info);

        callback();
    }
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple()
        }),
        new StreamTransport()
    ]
});

module.exports = { logger, logStream };
