/* eslint-disable @typescript-eslint/no-unused-vars */
import { type LeveledLogMethod, type Logger, addColors, createLogger, format, transports } from "winston";

const { combine, timestamp, label, colorize, printf } = format;

const customLevels = {
	extra: 0,
	white: 1,
	info: 2,
	warn: 3,
	error: 4,
	debug: 5,
	silly: 6,
};

addColors({
	info: "brightBlue",
	warn: "italic brightYellow",
	error: "brightRed",
	debug: "brightGreen",
	silly: "brightCyan",
	white: "brightWhite",
	extra: "brightYellow",
});

const timeStampLog = timestamp({
	format: "DD-MM-YY HH:mm:ss",
});

const alignColorsAndTime = combine(
	label({
		label: "[LOG]",
	}),
	timeStampLog,
	printf((info) => {
		const { label, timestamp, level, message } = info;

		return colorize().colorize(level, `${label} [${timestamp}] - [${level.toUpperCase()}]: ${message}`);
	})
);

const logInFile = combine(
	label({
		label: "[LOG]",
	}),
	timeStampLog,
	printf((info) => {
		const { label, timestamp, level, message } = info;

		return `${label} [${timestamp}] - [${level.toUpperCase()}]: ${message}`;
	})
);

const loggerBeforeWrapper = createLogger({
	levels: customLevels,
	level: "info",
	transports: [
		new transports.Console({
			format: combine(format.errors({ stack: true }), alignColorsAndTime),
			level: "debug",
		}),
		new transports.File({
			format: combine(logInFile),
			filename: "file.log",
			level: "extra",
		}),
	],
}) as Logger & Record<keyof typeof customLevels, LeveledLogMethod>;

function getCallerInfo(): string {
	const error = new Error();
	// Get both potential caller lines
	const stackLines = error.stack?.split("\n");
	const callerLine = stackLines?.[3]; // Current call location
	const functionLine = stackLines?.[4]; // Function name location

	let functionName = "unknown";
	let fileName = "unknown";
	let lineNumber = "unknown";

	// Extract file and line info from caller line
	const locationMatch = callerLine?.match(/at\s+(?:.*\s+\()?(.+):(\d+):(\d+)\)?/);
	if (locationMatch) {
		fileName = locationMatch[1]?.split("/").pop() ?? "unknown";
		lineNumber = locationMatch[2] ?? "unknown";
	}

	// Extract function name from function line
	const functionMatch = functionLine?.match(/at\s+(\w+)\s+\(/);
	if (functionMatch) {
		functionName = functionMatch[1] ?? "unknown";
		if (functionName === "processTicksAndRejections") {
			functionName = "unknown";
		}
	}

	return `[${fileName}:${lineNumber}] - ${functionName}() - `;
}

type LoggerLevel = "info" | "warn" | "error" | "debug" | "silly" | "white" | "extra";

// Create wrapper functions for each log level
const wrapLoggerMethod = (level: LoggerLevel): LeveledLogMethod => {
	return (message: any, ...args: any[]) => {
		const callerInfo = getCallerInfo();
		return loggerBeforeWrapper[level](`${callerInfo} ${message}`, ...args);
	};
};

// Export wrapped logger
export const logger = {
	info: wrapLoggerMethod("info"),
	warn: wrapLoggerMethod("warn"),
	error: wrapLoggerMethod("error"),
	debug: wrapLoggerMethod("debug"),
	silly: wrapLoggerMethod("silly"),
	white: wrapLoggerMethod("white"),
	extra: wrapLoggerMethod("extra"),
};
