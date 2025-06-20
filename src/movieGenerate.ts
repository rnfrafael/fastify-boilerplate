import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import fetch from "node-fetch";
import sharp from "sharp";
import { z } from "zod";
import { logger } from "./utils";
import { promises as fs } from "node:fs";
import path from "path";
import { randomUUID } from "crypto";

// Configuration constants
const WATERMARK_TEXT = "app.notifique.net";
const WATERMARK_ENABLED = true;
const UPLOADS_DIR = path.join(process.cwd(), "temp-images");

// Create uploads directory if it doesn't exist
const ensureUploadsDir = async () => {
	try {
		await fs.access(UPLOADS_DIR);
	} catch {
		await fs.mkdir(UPLOADS_DIR, { recursive: true });
	}
};

// Movie/promotional image generation schema
const imageGenerationSchema = z.object({
	logoUrl: z.string().url(),
	contato: z.string().optional(),
	whatsapp: z.string().optional(),
	capaFilmeUrl: z.string().url(),
	fundoUrl: z.string().url().optional(),
	titulo: z.string(),
	descricao: z.string(),
});

// Query parameters schema
const movieQuerySchema = z.object({
	base64: z
		.string()
		.optional()
		.transform((val) => val === "true"),
	file: z
		.string()
		.optional()
		.transform((val) => val === "true"),
});

// Response schema for base64 images
const movieBase64ResponseSchema = z.object({
	success: z.boolean(),
	images: z.object({
		landscape: z.string(),
		portrait: z.string(),
		square: z.string(),
	}),
	message: z.string(),
});

// Response schema for file links
const movieFileResponseSchema = z.object({
	success: z.boolean(),
	downloads: z.object({
		landscape: z.string(),
		portrait: z.string(),
		square: z.string(),
	}),
	message: z.string(),
	expiresIn: z.string(),
});

// Test response schemas (with testData)
const movieTestBase64ResponseSchema = z.object({
	success: z.boolean(),
	images: z.object({
		landscape: z.string(),
		portrait: z.string(),
		square: z.string(),
	}),
	message: z.string(),
	testData: z.any(),
});

const movieTestFileResponseSchema = z.object({
	success: z.boolean(),
	downloads: z.object({
		landscape: z.string(),
		portrait: z.string(),
		square: z.string(),
	}),
	message: z.string(),
	expiresIn: z.string(),
	testData: z.any(),
});

// Helper function to create placeholder image
async function createPlaceholderImage(width: number, height: number, color: string, text: string): Promise<Buffer> {
	const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
		<rect width="100%" height="100%" fill="${color}"/>
		<text x="50%" y="50%" font-family="Arial" font-size="20" fill="white" text-anchor="middle" dy=".3em">${text}</text>
	</svg>`;
	return Buffer.from(svg);
}

// Helper function to download image with fallback
async function downloadImageWithFallback(
	url: string,
	width: number = 300,
	height: number = 300,
	fallbackText: string = "IMAGE"
): Promise<Buffer> {
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		const buffer = await response.buffer();
		return await sharp(buffer).resize(width, height, { fit: "cover" }).png().toBuffer();
	} catch (error) {
		logger.warn(`Failed to download image from ${url}, using placeholder:`, error);
		return createPlaceholderImage(width, height, "#666666", fallbackText);
	}
}

// Helper function to create advanced gradient background
function createAdvancedGradientBackground(width: number, height: number, color: string = "#1a1a2e"): Buffer {
	const baseColor = color.replace("#", "");
	const r = parseInt(baseColor.substring(0, 2), 16);
	const g = parseInt(baseColor.substring(2, 4), 16);
	const b = parseInt(baseColor.substring(4, 6), 16);

	const gradientSvg = `
		<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<radialGradient id="movieGrad" cx="30%" cy="30%" r="70%">
					<stop offset="0%" style="stop-color:rgb(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(
		255,
		b + 60
	)});stop-opacity:0.9" />
					<stop offset="40%" style="stop-color:rgb(${r},${g},${b});stop-opacity:1" />
					<stop offset="100%" style="stop-color:rgb(${Math.max(0, r - 40)},${Math.max(0, g - 40)},${Math.max(
		0,
		b - 40
	)});stop-opacity:1" />
				</radialGradient>
			</defs>
			<rect width="100%" height="100%" fill="url(#movieGrad)" />
		</svg>
	`;

	return Buffer.from(gradientSvg);
}

// Helper function to create card background
async function createCardBackground(width: number, height: number): Promise<Buffer> {
	const cardSvg = `
		<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
					<feDropShadow dx="8" dy="12" stdDeviation="15" flood-color="rgba(0,0,0,0.3)"/>
				</filter>
			</defs>
			<rect x="40" y="40" width="${width - 80}" height="${height - 80}" rx="20" fill="white" filter="url(#cardShadow)"/>
		</svg>
	`;

	return Buffer.from(cardSvg);
}

// Helper function to escape XML characters
function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

// Helper function to wrap text
function wrapText(text: string, maxCharsPerLine: number): string[] {
	const words = text.split(" ");
	const lines: string[] = [];
	let currentLine = "";

	for (const word of words) {
		if ((currentLine + word).length <= maxCharsPerLine) {
			currentLine += (currentLine ? " " : "") + word;
		} else {
			if (currentLine) {
				lines.push(currentLine);
				currentLine = word;
			} else {
				lines.push(word);
			}
		}
	}

	if (currentLine) {
		lines.push(currentLine);
	}

	return lines;
}

// Helper function to create advanced text overlay
function createAdvancedTextOverlay(
	totalWidth: number,
	totalHeight: number,
	contentX: number,
	contentY: number,
	contentWidth: number,
	titulo: string,
	descricao: string,
	contato?: string,
	whatsapp?: string,
	titleFontSize: number = 32,
	descFontSize: number = 18,
	metaFontSize: number = 14
): string {
	const maxTitleChars = Math.floor(contentWidth / (titleFontSize * 0.6));
	const maxDescChars = Math.floor(contentWidth / (descFontSize * 0.6));

	const titleLines = wrapText(titulo, maxTitleChars);
	const descLines = wrapText(descricao, maxDescChars);

	let svg = `
		<svg width="${totalWidth}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<style>
					.title { 
						font-family: 'Arial Black', Arial, sans-serif; 
						font-weight: 900; 
						fill: #1a1a2e; 
						text-shadow: 1px 1px 2px rgba(0,0,0,0.1);
					}
					.description { 
						font-family: Arial, sans-serif; 
						fill: #333; 
						font-weight: 400;
						line-height: 1.4;
					}
					.meta { 
						font-family: Arial, sans-serif; 
						fill: #666; 
						font-weight: 600;
					}
					.watermark { 
						font-family: Arial, sans-serif; 
						fill: rgba(0,0,0,0.4); 
						font-weight: 500;
					}
				</style>
			</defs>
	`;

	let currentY = contentY + 40;

	// Add title lines
	titleLines.forEach((line, index) => {
		svg += `<text x="${contentX + 20}" y="${currentY}" font-size="${titleFontSize}" class="title">${escapeXml(
			line
		)}</text>`;
		currentY += titleFontSize + 8;
	});

	currentY += 20;

	// Add description lines
	descLines.forEach((line, index) => {
		svg += `<text x="${contentX + 20}" y="${currentY}" font-size="${descFontSize}" class="description">${escapeXml(
			line
		)}</text>`;
		currentY += descFontSize + 6;
	});

	// Add contact info at bottom
	const bottomY = contentY + contentWidth * 0.7; // Adjust based on content area

	if (contato) {
		svg += `<text x="${contentX + 20}" y="${bottomY}" font-size="${metaFontSize}" class="meta">📧 ${escapeXml(
			contato
		)}</text>`;
	}

	if (whatsapp) {
		const whatsappY = contato ? bottomY + metaFontSize + 8 : bottomY;
		svg += `<text x="${
			contentX + 20
		}" y="${whatsappY}" font-size="${metaFontSize}" class="meta">📱 WhatsApp: ${escapeXml(whatsapp)}</text>`;
	}

	// Add watermark
	if (WATERMARK_ENABLED) {
		const watermarkFontSize = Math.min(totalWidth * 0.015, 16);
		svg += `
			<text x="${totalWidth - 20}" y="${
			totalHeight - 20
		}" font-size="${watermarkFontSize}" class="watermark" text-anchor="end">
				${escapeXml(WATERMARK_TEXT)}
			</text>
		`;
	}

	svg += `</svg>`;
	return svg;
}

// Main function to create promotional image
async function createPromotionalImage(
	data: z.infer<typeof imageGenerationSchema>,
	width: number,
	height: number
): Promise<Buffer> {
	try {
		// Download all images in parallel
		const [logoBuffer, capaBuffer, backgroundBuffer] = await Promise.all([
			downloadImageWithFallback(data.logoUrl, 150, 150, "LOGO"),
			downloadImageWithFallback(data.capaFilmeUrl, 300, 450, "MOVIE"),
			data.fundoUrl
				? downloadImageWithFallback(data.fundoUrl, width, height, "BACKGROUND")
				: createAdvancedGradientBackground(width, height, "#1a1a2e"),
		]);

		// Create card background
		const cardBackground = await createCardBackground(width, height);

		// Calculate responsive dimensions
		const cardMargin = 40;
		const cardWidth = width - cardMargin * 2;
		const cardHeight = height - cardMargin * 2;

		// Movie poster dimensions (2:3 aspect ratio)
		const posterWidth = Math.min(cardWidth * 0.35, 300);
		const posterHeight = posterWidth * 1.5;

		// Content area (right side of the card)
		const contentX = cardMargin + posterWidth + 30;
		const contentY = cardMargin;
		const contentWidth = cardWidth - posterWidth - 50;

		// Logo dimensions (responsive)
		const logoSize = Math.min(contentWidth * 0.25, 100);

		// Font sizes (responsive)
		const titleFontSize = Math.min(width * 0.025, 32);
		const descFontSize = Math.min(width * 0.015, 18);
		const metaFontSize = Math.min(width * 0.012, 14);

		// Resize images
		const [logoResized, capaResized] = await Promise.all([
			sharp(logoBuffer).resize(Math.round(logoSize), Math.round(logoSize), { fit: "inside" }).png().toBuffer(),
			sharp(capaBuffer).resize(Math.round(posterWidth), Math.round(posterHeight), { fit: "cover" }).png().toBuffer(),
		]);

		// Create text overlay
		const textOverlay = createAdvancedTextOverlay(
			width,
			height,
			contentX,
			contentY,
			contentWidth,
			data.titulo,
			data.descricao,
			data.contato,
			data.whatsapp,
			titleFontSize,
			descFontSize,
			metaFontSize
		);

		// Create base image with background
		const baseImage = sharp(backgroundBuffer).resize(width, height, { fit: "cover" });

		// Composite all elements
		const finalImage = await baseImage
			.composite([
				// Card background
				{ input: cardBackground, blend: "over" },
				// Movie poster (left side)
				{
					input: capaResized,
					left: cardMargin + 20,
					top: cardMargin + 20,
					blend: "over",
				},
				// Text overlay
				{ input: Buffer.from(textOverlay), blend: "over" },
				// Logo (top right of content area)
				{
					input: logoResized,
					left: Math.round(contentX + contentWidth - logoSize - 20),
					top: cardMargin + 20,
					blend: "over",
				},
			])
			.jpeg({ quality: 95 })
			.toBuffer();

		return finalImage;
	} catch (error) {
		logger.error("Error creating promotional image:", error);
		throw error;
	}
}

// Helper function to save image and get download link
async function saveImageAndGetLink(imageBuffer: Buffer, filename: string, request: any): Promise<string> {
	await ensureUploadsDir();
	const filePath = path.join(UPLOADS_DIR, filename);
	await fs.writeFile(filePath, imageBuffer);

	// Schedule file deletion after 1 hour
	setTimeout(async () => {
		try {
			await fs.unlink(filePath);
			logger.debug(`Deleted temporary file: ${filename}`);
		} catch (error) {
			logger.warn(`Failed to delete temporary file: ${filename}`, error);
		}
	}, 60 * 60 * 1000); // 1 hour

	// Return download URL
	const protocol = request.headers["x-forwarded-proto"] || (request.socket.encrypted ? "https" : "http");
	const host = request.headers["x-forwarded-host"] || request.headers.host;
	return `${protocol}://${host}/api/download/${filename}`;
}

export const movieRoutes: FastifyPluginAsyncZod = async (app) => {
	// Movie/promotional image generation endpoint with flexible response format
	app.post(
		"/generate-images",
		{
			schema: {
				tags: ["Movie Generation"],
				description: "Generate promotional images - Returns base64 or file links based on query params",
				body: imageGenerationSchema,
				querystring: movieQuerySchema,
				response: {
					200: z.union([movieBase64ResponseSchema, movieFileResponseSchema]),
				},
			},
		},
		async (request, reply) => {
			try {
				const data = request.body;
				const query = request.query;

				// Determine response format (default to file if no params specified)
				const useBase64 = query.base64 === true;
				const useFile = query.file === true || (!query.base64 && !query.file);

				// Full HD resolutions for each format
				const resolutions = {
					landscape: { width: 1920, height: 1080 }, // 16:9
					portrait: { width: 1080, height: 1920 }, // 9:16
					square: { width: 1080, height: 1080 }, // 1:1
				};

				// Generate images in parallel
				const [landscapeImage, portraitImage, squareImage] = await Promise.all([
					createPromotionalImage(data, resolutions.landscape.width, resolutions.landscape.height),
					createPromotionalImage(data, resolutions.portrait.width, resolutions.portrait.height),
					createPromotionalImage(data, resolutions.square.width, resolutions.square.height),
				]);

				if (useBase64) {
					// Return base64 images
					const images = {
						landscape: `data:image/jpeg;base64,${landscapeImage.toString("base64")}`,
						portrait: `data:image/jpeg;base64,${portraitImage.toString("base64")}`,
						square: `data:image/jpeg;base64,${squareImage.toString("base64")}`,
					};

					return reply.code(200).send({
						success: true,
						images,
						message: "Promotional images generated successfully (base64)",
					});
				} else {
					// Save files and return download links
					const sessionId = randomUUID();
					const [landscapeLink, portraitLink, squareLink] = await Promise.all([
						saveImageAndGetLink(landscapeImage, `movie_${sessionId}_landscape.jpg`, request),
						saveImageAndGetLink(portraitImage, `movie_${sessionId}_portrait.jpg`, request),
						saveImageAndGetLink(squareImage, `movie_${sessionId}_square.jpg`, request),
					]);

					const downloads = {
						landscape: landscapeLink,
						portrait: portraitLink,
						square: squareLink,
					};

					return reply.code(200).send({
						success: true,
						downloads,
						message: "Promotional images generated successfully (download links)",
						expiresIn: "1 hour",
					});
				}
			} catch (error) {
				logger.error("Error generating promotional images:", error);
				return reply.code(500).send({
					success: false,
					message: error instanceof Error ? error.message : "Unknown error",
					images: {
						landscape: "",
						portrait: "",
						square: "",
					},
				});
			}
		}
	);

	// Movie example endpoint
	app.get(
		"/example",
		{
			schema: {
				tags: ["Movie Generation"],
				description: "Get example request body for movie image generation",
			},
		},
		async (request, reply) => {
			const example = {
				logoUrl: "https://via.placeholder.com/150x150/0066CC/FFFFFF?text=LOGO",
				contato: "contato@empresa.com",
				whatsapp: "(11) 99999-9999",
				capaFilmeUrl: "https://via.placeholder.com/300x450/FF6B6B/FFFFFF?text=MOVIE+POSTER",
				fundoUrl: "https://via.placeholder.com/1920x1080/4ECDC4/FFFFFF?text=BACKGROUND",
				titulo: "Filme Incrível 2024",
				descricao: "Uma aventura épica que vai emocionar toda a família. Não perca esta experiência única no cinema!",
			};

			return reply.code(200).send({
				example,
				usage:
					"POST /api/generate-images com o JSON acima no body. Query params: ?base64=true (para base64) ou ?file=true (para links). Padrão é file=true. Os campos 'contato', 'whatsapp' e 'fundoUrl' são opcionais.",
			});
		}
	);

	// Test movie banner endpoint with query params support
	app.post(
		"/test-banner",
		{
			schema: {
				tags: ["Movie Generation"],
				description: "Test promotional image generation with random data",
				querystring: movieQuerySchema,
				response: {
					200: z.union([movieTestBase64ResponseSchema, movieTestFileResponseSchema]),
				},
			},
		},
		async (request, reply) => {
			try {
				const query = request.query;

				// Determine response format (default to file if no params specified)
				const useBase64 = query.base64 === true;
				const useFile = query.file === true || (!query.base64 && !query.file);

				const testData = {
					logoUrl: "http://fake-logo.local/logo.png",
					contato: "teste@empresa.com",
					whatsapp: "(11) 99999-9999",
					capaFilmeUrl: "http://fake-movie-poster.local/poster.jpg",
					titulo: "Filme de Teste",
					descricao:
						"Esta é uma descrição de teste para verificar se a geração de imagens está funcionando corretamente com textos longos e múltiplas linhas.",
				};

				// Full HD resolutions for each format
				const resolutions = {
					landscape: { width: 1920, height: 1080 }, // 16:9
					portrait: { width: 1080, height: 1920 }, // 9:16
					square: { width: 1080, height: 1080 }, // 1:1
				};

				// Generate images in parallel
				const [landscapeImage, portraitImage, squareImage] = await Promise.all([
					createPromotionalImage(testData, resolutions.landscape.width, resolutions.landscape.height),
					createPromotionalImage(testData, resolutions.portrait.width, resolutions.portrait.height),
					createPromotionalImage(testData, resolutions.square.width, resolutions.square.height),
				]);

				if (useBase64) {
					// Return base64 images
					const images = {
						landscape: `data:image/jpeg;base64,${landscapeImage.toString("base64")}`,
						portrait: `data:image/jpeg;base64,${portraitImage.toString("base64")}`,
						square: `data:image/jpeg;base64,${squareImage.toString("base64")}`,
					};

					return reply.code(200).send({
						success: true,
						images,
						message: "Test promotional images generated successfully (base64)",
						testData,
					});
				} else {
					// Save files and return download links
					const sessionId = randomUUID();
					const [landscapeLink, portraitLink, squareLink] = await Promise.all([
						saveImageAndGetLink(landscapeImage, `test_movie_${sessionId}_landscape.jpg`, request),
						saveImageAndGetLink(portraitImage, `test_movie_${sessionId}_portrait.jpg`, request),
						saveImageAndGetLink(squareImage, `test_movie_${sessionId}_square.jpg`, request),
					]);

					const downloads = {
						landscape: landscapeLink,
						portrait: portraitLink,
						square: squareLink,
					};

					return reply.code(200).send({
						success: true,
						downloads,
						message: "Test promotional images generated successfully (download links)",
						expiresIn: "1 hour",
						testData,
					});
				}
			} catch (error) {
				logger.error("Error generating test promotional images:", error);
				return reply.code(500).send({
					success: false,
					message: error instanceof Error ? error.message : "Unknown error",
					images: {
						landscape: "",
						portrait: "",
						square: "",
					},
				});
			}
		}
	);
};
