import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import fetch from "node-fetch";
import sharp from "sharp";
import { z } from "zod";
import { logger } from "./utils";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Create uploads directory if it doesn't exist
const UPLOADS_DIR = path.join(process.cwd(), "temp-images");
const ensureUploadsDir = async () => {
	try {
		await fs.access(UPLOADS_DIR);
	} catch {
		await fs.mkdir(UPLOADS_DIR, { recursive: true });
	}
};

// Image generation schema
const imageGenerationSchema = z.object({
	logoUrl: z.string().url().describe("URL do logo da empresa/usuário"),
	contato: z.string().optional().describe("Contato do usuário"),
	whatsapp: z.string().optional().describe("WhatsApp do usuário"),
	capaFilmeUrl: z.string().url().describe("URL da capa do filme"),
	fundoUrl: z.string().url().optional().describe("URL da imagem de fundo"),
	titulo: z.string().describe("Título do filme/conteúdo"),
	descricao: z.string().describe("Descrição do filme/conteúdo"),
	corFundo: z.string().optional().describe("Cor de fundo em hex (ex: #FF0000) se não enviar fundoUrl"),
});

// Response schema for file downloads
const imageDownloadResponseSchema = z.object({
	success: z.boolean(),
	downloadLinks: z
		.object({
			landscape: z.string().describe("Link para download da imagem 16:9"),
			portrait: z.string().describe("Link para download da imagem 9:16"),
			square: z.string().describe("Link para download da imagem 1:1"),
		})
		.optional(),
	expiresAt: z.string().optional().describe("Data/hora de expiração dos links (ISO 8601)"),
	error: z.string().optional().describe("Mensagem de erro"),
	message: z.string().optional().describe("Detalhes do erro"),
});

// Response schema for base64 (keeping for compatibility)
const imageResponseSchema = z.object({
	success: z.boolean(),
	images: z.object({
		landscape: z.string().describe("Imagem 16:9 em base64"),
		portrait: z.string().describe("Imagem 9:16 em base64"),
		square: z.string().describe("Imagem 1:1 em base64"),
	}),
});

// Helper function to create local placeholder image
async function createPlaceholderImage(width: number, height: number, color: string, text: string): Promise<Buffer> {
	const svg = `
		<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
			<rect width="100%" height="100%" fill="${color}"/>
			<text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${Math.min(width, height) * 0.1}" 
				  fill="white" text-anchor="middle" dominant-baseline="middle">${text}</text>
		</svg>
	`;
	return Buffer.from(svg);
}

// Helper function to download image from URL with fallback to placeholder
async function downloadImageWithFallback(
	url: string,
	width: number = 300,
	height: number = 300,
	fallbackText: string = "IMAGE"
): Promise<Buffer> {
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to download image: ${response.statusText}`);
		}
		return Buffer.from(await response.arrayBuffer());
	} catch (error) {
		logger.warn(`Failed to download image from ${url}, using placeholder:`, error);
		// Create a random color for the placeholder
		const colors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F"];
		const randomColor = colors[Math.floor(Math.random() * colors.length)] ?? "#FF6B6B";
		return await sharp(await createPlaceholderImage(width, height, randomColor, fallbackText))
			.resize(width, height)
			.png()
			.toBuffer();
	}
}

// Helper function to create gradient background
function createGradientBackground(width: number, height: number, color: string = "#1a1a2e"): Buffer {
	const baseColor = color.replace("#", "");
	const r = parseInt(baseColor.substring(0, 2), 16);
	const g = parseInt(baseColor.substring(2, 4), 16);
	const b = parseInt(baseColor.substring(4, 6), 16);

	// Create a simple gradient SVG
	const gradientSvg = `
		<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" style="stop-color:rgb(${r},${g},${b});stop-opacity:1" />
					<stop offset="100%" style="stop-color:rgb(${Math.max(0, r - 50)},${Math.max(0, g - 50)},${Math.max(
		0,
		b - 50
	)});stop-opacity:1" />
				</linearGradient>
			</defs>
			<rect width="100%" height="100%" fill="url(#grad)" />
		</svg>
	`;

	return Buffer.from(gradientSvg);
}

// Helper function to create promotional image
async function createPromotionalImage(
	data: z.infer<typeof imageGenerationSchema>,
	width: number,
	height: number
): Promise<Buffer> {
	try {
		// Download required images with fallbacks
		const [logoBuffer, capaBuffer] = await Promise.all([
			downloadImageWithFallback(data.logoUrl, 200, 200, "LOGO"),
			downloadImageWithFallback(data.capaFilmeUrl, 400, 600, "FILME"),
		]);

		// Create background
		let backgroundBuffer: Buffer;
		if (data.fundoUrl) {
			backgroundBuffer = await downloadImageWithFallback(data.fundoUrl, width, height, "FUNDO");
		} else {
			// Create a more sophisticated gradient background
			const color = data.corFundo || "#1a1a2e";
			backgroundBuffer = createAdvancedGradientBackground(width, height, color);
		}

		// Create base image with background
		const baseImage = sharp(backgroundBuffer).resize(width, height, { fit: "cover" });

		// Calculate card dimensions and positioning
		const cardMargin = Math.min(width * 0.05, height * 0.05);
		const cardWidth = width - cardMargin * 2;
		const cardHeight = height - cardMargin * 2;

		// Movie poster dimensions (left side)
		const posterWidth = Math.min(cardHeight * 0.7, cardWidth * 0.3);
		const posterHeight = posterWidth * 1.5; // 2:3 aspect ratio for movie poster
		const posterX = cardMargin + cardHeight * 0.1;
		const posterY = cardMargin + (cardHeight - posterHeight) / 2;

		// Content area (right side)
		const contentX = posterX + posterWidth + cardWidth * 0.05;
		const contentWidth = cardWidth - posterWidth - cardWidth * 0.15;
		const contentY = cardMargin + cardHeight * 0.1;

		// Resize movie poster
		const posterResized = await sharp(capaBuffer)
			.resize(Math.round(posterWidth), Math.round(posterHeight), { fit: "cover" })
			.png()
			.toBuffer();

		// Resize logo (smaller, positioned in content area)
		const logoSize = Math.min(contentWidth * 0.15, 80);
		const logoResized = await sharp(logoBuffer)
			.resize(Math.round(logoSize), Math.round(logoSize), { fit: "inside" })
			.png()
			.toBuffer();

		// Create card background with rounded corners and shadow effect
		const cardBackground = await createCardBackground(cardWidth, cardHeight);

		// Calculate font sizes responsively
		const titleFontSize = Math.min(width * 0.035, height * 0.05, 48);
		const descFontSize = Math.min(width * 0.018, height * 0.025, 24);
		const metaFontSize = Math.min(width * 0.015, height * 0.02, 18);

		// Create text content with better typography
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

		// Composite all elements with proper layering
		const finalImage = await baseImage
			.composite([
				// Card background
				{
					input: cardBackground,
					left: Math.round(cardMargin),
					top: Math.round(cardMargin),
					blend: "over",
				},
				// Movie poster
				{
					input: posterResized,
					left: Math.round(posterX),
					top: Math.round(posterY),
					blend: "over",
				},
				// Logo (top right of content area)
				{
					input: logoResized,
					left: Math.round(contentX + contentWidth - logoSize),
					top: Math.round(contentY),
					blend: "over",
				},
				// Text overlay
				{
					input: Buffer.from(textOverlay),
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

// Helper function to create advanced gradient background
function createAdvancedGradientBackground(width: number, height: number, color: string = "#1a1a2e"): Buffer {
	const baseColor = color.replace("#", "");
	const r = parseInt(baseColor.substring(0, 2), 16);
	const g = parseInt(baseColor.substring(2, 4), 16);
	const b = parseInt(baseColor.substring(4, 6), 16);

	// Create multiple gradient stops for more depth
	const gradientSvg = `
		<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<radialGradient id="bgGrad" cx="30%" cy="30%">
					<stop offset="0%" style="stop-color:rgb(${Math.min(255, r + 30)},${Math.min(255, g + 30)},${Math.min(
		255,
		b + 30
	)});stop-opacity:1" />
					<stop offset="50%" style="stop-color:rgb(${r},${g},${b});stop-opacity:1" />
					<stop offset="100%" style="stop-color:rgb(${Math.max(0, r - 40)},${Math.max(0, g - 40)},${Math.max(
		0,
		b - 40
	)});stop-opacity:1" />
				</radialGradient>
			</defs>
			<rect width="100%" height="100%" fill="url(#bgGrad)" />
		</svg>
	`;

	return Buffer.from(gradientSvg);
}

// Helper function to create card background with shadow
async function createCardBackground(width: number, height: number): Promise<Buffer> {
	const cardSvg = `
		<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
					<feDropShadow dx="4" dy="8" stdDeviation="8" flood-color="rgba(0,0,0,0.3)"/>
				</filter>
			</defs>
			<rect x="0" y="0" width="100%" height="100%" rx="12" ry="12" 
				  fill="rgba(255,255,255,0.95)" filter="url(#shadow)" />
		</svg>
	`;

	return Buffer.from(cardSvg);
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
	// Calculate text positions
	const titleY = contentY + titleFontSize + 20;
	const descY = titleY + titleFontSize + 30;
	const contactStartY = totalHeight - 120;

	// Truncate text to fit
	const maxTitleLength = Math.floor(contentWidth / (titleFontSize * 0.6));
	const maxDescLength = Math.floor((contentWidth * 3) / (descFontSize * 0.6));

	const truncatedTitle = titulo.length > maxTitleLength ? titulo.substring(0, maxTitleLength - 3) + "..." : titulo;

	const truncatedDesc =
		descricao.length > maxDescLength ? descricao.substring(0, maxDescLength - 3) + "..." : descricao;

	// Split description into multiple lines
	const descLines = wrapText(truncatedDesc, Math.floor(contentWidth / (descFontSize * 0.6)));

	// Create SVG with sophisticated typography
	let textSvg = `
		<svg width="${totalWidth}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<style>
					.title { font-family: 'Arial Black', Arial, sans-serif; font-weight: bold; fill: #2c3e50; }
					.desc { font-family: Arial, sans-serif; fill: #34495e; line-height: 1.4; }
					.meta { font-family: Arial, sans-serif; fill: #7f8c8d; font-weight: 500; }
				</style>
			</defs>
			
			<!-- Title -->
			<text x="${contentX}" y="${titleY}" font-size="${titleFontSize}" class="title">
				${escapeXml(truncatedTitle)}
			</text>
	`;

	// Add description lines
	descLines.forEach((line, index) => {
		const lineY = descY + index * (descFontSize + 8);
		if (lineY < contactStartY - 40) {
			// Don't overlap with contact info
			textSvg += `
				<text x="${contentX}" y="${lineY}" font-size="${descFontSize}" class="desc">
					${escapeXml(line)}
				</text>
			`;
		}
	});

	// Add contact information at bottom
	let contactY = contactStartY;
	if (contato) {
		textSvg += `
			<text x="${contentX}" y="${contactY}" font-size="${metaFontSize}" class="meta">
				📧 ${escapeXml(contato)}
			</text>
		`;
		contactY += metaFontSize + 12;
	}

	if (whatsapp) {
		textSvg += `
			<text x="${contentX}" y="${contactY}" font-size="${metaFontSize}" class="meta">
				📱 ${escapeXml(whatsapp)}
			</text>
		`;
	}

	textSvg += `</svg>`;
	return textSvg;
}

// Helper function to wrap text into lines
function wrapText(text: string, maxCharsPerLine: number): string[] {
	const words = text.split(" ");
	const lines: string[] = [];
	let currentLine = "";

	for (const word of words) {
		if ((currentLine + word).length <= maxCharsPerLine) {
			currentLine += (currentLine ? " " : "") + word;
		} else {
			if (currentLine) lines.push(currentLine);
			currentLine = word;
		}
	}

	if (currentLine) lines.push(currentLine);
	return lines.slice(0, 4); // Max 4 lines for description
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

// Helper function to save image and return download link
async function saveImageAndGetLink(imageBuffer: Buffer, filename: string, request: any): Promise<string> {
	await ensureUploadsDir();
	const filepath = path.join(UPLOADS_DIR, filename);
	await fs.writeFile(filepath, imageBuffer);

	// Schedule file deletion after 30 minutes
	setTimeout(async () => {
		try {
			await fs.unlink(filepath);
			logger.info(`Deleted expired image: ${filename}`);
		} catch (error) {
			logger.warn(`Failed to delete expired image ${filename}:`, error);
		}
	}, 30 * 60 * 1000); // 30 minutes in milliseconds

	// Return download URL
	const protocol = request.protocol;
	const host = request.headers.host;
	return `${protocol}://${host}/api/download/${filename}`;
}

export const imageRoutes: FastifyPluginAsyncZod = async (app) => {
	// Image generation endpoint with download links
	app.post(
		"/generate-images",
		{
			schema: {
				tags: ["Image Generation"],
				description: "Generate promotional images in 3 formats (16:9, 9:16, 1:1) - Returns download links",
				body: imageGenerationSchema,
				response: {
					200: imageDownloadResponseSchema,
				},
			},
		},
		async (request, reply) => {
			try {
				const data = request.body;
				const sessionId = randomUUID();

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

				// Save images and get download links
				const [landscapeLink, portraitLink, squareLink] = await Promise.all([
					saveImageAndGetLink(landscapeImage, `${sessionId}_landscape.jpg`, request),
					saveImageAndGetLink(portraitImage, `${sessionId}_portrait.jpg`, request),
					saveImageAndGetLink(squareImage, `${sessionId}_square.jpg`, request),
				]);

				// Calculate expiration time (30 minutes from now)
				const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

				return reply.code(200).send({
					success: true,
					downloadLinks: {
						landscape: landscapeLink,
						portrait: portraitLink,
						square: squareLink,
					},
					expiresAt,
				});
			} catch (error) {
				logger.error("Error in image generation endpoint:", error);
				return reply.code(500).send({
					success: false,
					error: "Failed to generate images",
					message: error instanceof Error ? error.message : "Unknown error",
				});
			}
		}
	);

	// Download endpoint for generated images
	app.get(
		"/download/:filename",
		{
			schema: {
				tags: ["Image Generation"],
				description: "Download generated image file",
				params: z.object({
					filename: z.string().describe("Nome do arquivo para download"),
				}),
			},
		},
		async (request, reply) => {
			try {
				const { filename } = request.params;
				const filepath = path.join(UPLOADS_DIR, filename);

				// Check if file exists
				try {
					await fs.access(filepath);
				} catch {
					return reply.code(404).send({
						success: false,
						error: "File not found or expired",
					});
				}

				// Set proper headers for image download
				const ext = path.extname(filename).toLowerCase();
				const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";

				reply.header("Content-Type", mimeType);
				reply.header("Content-Disposition", `attachment; filename="${filename}"`);

				// Stream the file
				const fileBuffer = await fs.readFile(filepath);
				return reply.send(fileBuffer);
			} catch (error) {
				logger.error("Error in download endpoint:", error);
				return reply.code(500).send({
					success: false,
					error: "Failed to download image",
					message: error instanceof Error ? error.message : "Unknown error",
				});
			}
		}
	);

	// Example endpoint with sample data
	app.get(
		"/example",
		{
			schema: {
				tags: ["Image Generation"],
				description: "Get example request body for image generation",
				response: {
					200: z.object({
						example: imageGenerationSchema,
						usage: z.string(),
					}),
				},
			},
		},
		async (request, reply) => {
			const example = {
				logoUrl: "https://via.placeholder.com/200x200/FF0000/FFFFFF?text=LOGO",
				contato: "contato@empresa.com",
				whatsapp: "+55 11 99999-9999",
				capaFilmeUrl: "https://via.placeholder.com/300x450/0000FF/FFFFFF?text=FILME",
				fundoUrl: "https://via.placeholder.com/1920x1080/00FF00/000000?text=FUNDO",
				titulo: "Título do Filme Incrível",
				descricao: "Esta é uma descrição detalhada do filme que será exibida na imagem promocional.",
				corFundo: "#1a1a2e",
			};

			return reply.code(200).send({
				example,
				usage:
					"POST /api/generate-images com o JSON acima no body. Os campos 'contato', 'whatsapp', 'fundoUrl' e 'corFundo' são opcionais.",
			});
		}
	);

	// Test route - Generate random test banner with local placeholders
	app.get(
		"/test-banner",
		{
			schema: {
				tags: ["Image Generation"],
				description: "Generate a test banner with random placeholder data (no external URLs)",
				response: {
					200: imageDownloadResponseSchema,
				},
			},
		},
		async (request, reply) => {
			try {
				const randomTitles = [
					"Filme de Ação Épico",
					"Comédia Romântica",
					"Drama Emocionante",
					"Thriller Suspense",
					"Aventura Fantástica",
					"Ficção Científica",
					"Terror Assombrado",
					"Documentário Incrível",
				];

				const randomDescriptions = [
					"Uma história emocionante que vai te prender do início ao fim.",
					"Prepare-se para uma aventura única cheia de surpresas e emoções.",
					"Um filme que marcará sua vida com momentos inesquecíveis.",
					"A produção mais aguardada do ano finalmente chegou.",
					"Uma obra-prima cinematográfica que você não pode perder.",
					"Romance, ação e drama se misturam nesta super produção.",
					"Baseado em fatos reais que irão te surpreender completamente.",
					"A continuação da saga mais amada pelos fãs do mundo todo.",
				];

				const randomColors = [
					"#1a1a2e",
					"#16213e",
					"#0f3460",
					"#533a71",
					"#6a4c93",
					"#8b5cf6",
					"#3b82f6",
					"#06b6d4",
					"#10b981",
					"#f59e0b",
					"#ef4444",
					"#ec4899",
				];

				const randomContacts = ["contato@empresa.com", "vendas@streaming.com", "info@cinema.com", "suporte@filmes.com"];

				const randomWhatsApp = ["+55 11 99999-9999", "+55 21 98888-8888", "+55 31 97777-7777", "+55 85 96666-6666"];

				// Generate random selections
				const titulo = randomTitles[Math.floor(Math.random() * randomTitles.length)]!;
				const descricao = randomDescriptions[Math.floor(Math.random() * randomDescriptions.length)]!;
				const corFundo = randomColors[Math.floor(Math.random() * randomColors.length)]!;
				const contato =
					Math.random() > 0.5 ? randomContacts[Math.floor(Math.random() * randomContacts.length)] : undefined;
				const whatsapp =
					Math.random() > 0.5 ? randomWhatsApp[Math.floor(Math.random() * randomWhatsApp.length)] : undefined;

				// Create fake URLs that will fail and trigger placeholders
				const testData = {
					logoUrl: "http://fake-url-logo.local/logo.png",
					contato,
					whatsapp,
					capaFilmeUrl: "http://fake-url-capa.local/filme.jpg",
					fundoUrl: "http://fake-url-fundo.local/background.jpg",
					titulo,
					descricao,
					corFundo,
				};

				const sessionId = randomUUID();

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

				// Save images and get download links
				const [landscapeLink, portraitLink, squareLink] = await Promise.all([
					saveImageAndGetLink(landscapeImage, `test_${sessionId}_landscape.jpg`, request),
					saveImageAndGetLink(portraitImage, `test_${sessionId}_portrait.jpg`, request),
					saveImageAndGetLink(squareImage, `test_${sessionId}_square.jpg`, request),
				]);

				// Calculate expiration time (30 minutes from now)
				const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

				return reply.code(200).send({
					success: true,
					downloadLinks: {
						landscape: landscapeLink,
						portrait: portraitLink,
						square: squareLink,
					},
					expiresAt,
				});
			} catch (error) {
				logger.error("Error in test banner generation:", error);
				return reply.code(500).send({
					success: false,
					error: "Failed to generate test banner",
					message: error instanceof Error ? error.message : "Unknown error",
				});
			}
		}
	);
};
