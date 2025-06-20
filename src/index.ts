import cors from "@fastify/cors";
import FastifySwagger from "@fastify/swagger";
import ScalarApiReference from "@scalar/fastify-api-reference";
import fastify, { errorCodes } from "fastify";
import {
	hasZodFastifySchemaValidationErrors,
	isResponseSerializationError,
	jsonSchemaTransform,
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { footballRoutes } from "./footballGenerate";
import { footballHtmlRoutes } from "./footballGenerateHtml";
import { movieRoutes } from "./movieGenerate";
import { logger } from "./utils";

const app = fastify({ requestTimeout: 60000 }).withTypeProvider<ZodTypeProvider>();
const port = Number(process.env.PORT) || 3003;

// Set compilers first, before any plugin registration
app.setSerializerCompiler(serializerCompiler);
app.setValidatorCompiler(validatorCompiler);

// Register plugins in correct order
app.register(cors, {});

// Register Swagger before routes so it can collect schemas
app.register(FastifySwagger, {
	openapi: {
		info: {
			title: "Image Generation API",
			version: "1.0.0",
		},
	},
	transform: jsonSchemaTransform,
});

// Register the API routes after Swagger
app.register(footballRoutes, { prefix: "/api" });
app.register(footballHtmlRoutes, { prefix: "/api" });
app.register(movieRoutes, { prefix: "/api" });

// Register Scalar docs last
app.register(ScalarApiReference, {
	routePrefix: "/reference",
	configuration: {
		hideModels: true,
	},
});

app.addHook("onRequest", async (request) => {
	request.startTime = Date.now();
	request.requestId = randomUUID();
	logger.debug(`[Start] [${request.requestId}] ${request.ip} ${request.method} ${request.url}`);
});

app.addHook("onResponse", async (request, reply) => {
	const duration = Date.now() - request.startTime;
	logger.debug(
		`[End] [${request.requestId}] ${request.ip} ${request.method} ${request.url} - ${duration}ms - Status: ${reply.statusCode}`
	);
});

app.setErrorHandler((error, request, reply) => {
	if (hasZodFastifySchemaValidationErrors(error)) {
		return reply.code(400).send({
			error: "Response Validation Error",
			message: "Request doesn't match the schema",
			statusCode: 400,
			details: {
				issues: error.validation,
				method: request.method,
				url: request.url,
			},
		});
	}

	if (isResponseSerializationError(error)) {
		return reply.code(500).send({
			error: "Internal Server Error",
			message: "Response doesn't match the schema",
			statusCode: 500,
			details: {
				issues: error.cause.issues,
				method: error.method,
				url: error.url,
			},
		});
	}

	if (error instanceof errorCodes.FST_ERR_BAD_STATUS_CODE) {
		// Log error
		logger.error(`[setErrorHandler], ${error}`);
		// Send error response
		return reply.status(500).send({ ok: false });
	}
	logger.error(`[setErrorHandler], ${error}`);
	// fastify will use parent error handler to handle this
	return reply.send(error);
});

const start = async () => {
	try {
		await app.listen({ port, host: "0.0.0.0" });
		console.log(`Server listening on port:${port}`);
	} catch (err) {
		logger.error(`Error on ${err}`);
		process.exit(1);
	}
};

start();
