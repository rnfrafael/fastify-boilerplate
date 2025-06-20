import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import fetch from "node-fetch";
import sharp from "sharp";
import { z } from "zod";
import { logger } from "./utils";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Configuration constants
const WATERMARK_TEXT = "app.notifique.net";
const WATERMARK_ENABLED = true;

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

// Football schedule schema
const footballScheduleSchema = z.object({
	logoEmpresaUrl: z.string().url().describe("URL do logo da empresa"),
	fundoUrl: z.string().url().optional().describe("URL da imagem de fundo"),
	whatsapp: z.string().optional().describe("WhatsApp da empresa"),
	corFundo: z.string().optional().describe("Cor de fundo em hex (ex: #1E3A8A) se não enviar fundoUrl"),
	data: z.string().describe("Data dos jogos (ex: 19/06)"),
	jogos: z
		.array(
			z.object({
				timeHome: z.string().describe("Nome do time da casa"),
				logoHomeUrl: z.string().url().describe("URL do logo do time da casa"),
				timeAway: z.string().describe("Nome do time visitante"),
				logoAwayUrl: z.string().url().describe("URL do logo do time visitante"),
				horario: z.string().describe("Horário do jogo (ex: 13H00)"),
				canal: z.string().optional().describe("Canal de TV (ex: SporTV)"),
			})
		)
		.max(5)
		.describe("Lista de jogos (máximo 5)"),
});

// Football schedule response schema
const footballScheduleResponseSchema = z.object({
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

// Helper function to create football schedule image
async function createFootballScheduleImage(
	data: z.infer<typeof footballScheduleSchema>,
	width: number,
	height: number
): Promise<Buffer> {
	try {
		// Download company logo with bigger size
		const logoEmpresaBuffer = await downloadImageWithFallback(data.logoEmpresaUrl, 200, 200, "LOGO");

		// Create background
		let backgroundBuffer: Buffer;
		if (data.fundoUrl) {
			backgroundBuffer = await downloadImageWithFallback(data.fundoUrl, width, height, "FUNDO");
		} else {
			// Create football-themed gradient background (blue theme like the example)
			const color = data.corFundo || "#1E3A8A";
			backgroundBuffer = createFootballGradientBackground(width, height, color);
		}

		// Create base image with background
		const baseImage = sharp(backgroundBuffer).resize(width, height, { fit: "cover" });

		// Download all team logos with bigger size
		const teamLogos: Buffer[] = [];
		for (const jogo of data.jogos) {
			const [logoHome, logoAway] = await Promise.all([
				downloadImageWithFallback(jogo.logoHomeUrl, 120, 120, jogo.timeHome.substring(0, 3)),
				downloadImageWithFallback(jogo.logoAwayUrl, 120, 120, jogo.timeAway.substring(0, 3)),
			]);
			teamLogos.push(logoHome, logoAway);
		}

		// Resize company logo (much bigger)
		const logoSize = Math.min(width * 0.12, 180);
		const logoEmpresaResized = await sharp(logoEmpresaBuffer)
			.resize(Math.round(logoSize), Math.round(logoSize), { fit: "inside" })
			.png()
			.toBuffer();

		// Create the schedule overlay
		const scheduleOverlay = createFootballScheduleOverlay(width, height, data.data, data.jogos, data.whatsapp);

		// Create all composite operations
		const compositeOperations: any[] = [
			// Schedule overlay (background elements)
			{ input: Buffer.from(scheduleOverlay), blend: "over" },
			// Company logo (top right, better positioned)
			{
				input: logoEmpresaResized,
				left: width - Math.round(logoSize) - 30,
				top: 30,
				blend: "over",
			},
		];

		// Add team logos for each game
		const gameHeight = (height - 200) / Math.max(data.jogos.length, 1);
		const startY = 150;

		for (let i = 0; i < data.jogos.length; i++) {
			const gameY = startY + i * gameHeight;
			const teamLogoSize = Math.min(gameHeight * 0.5, 90);

			// Resize team logos for this game (bigger)
			const logoHomeResized = await sharp(teamLogos[i * 2])
				.resize(Math.round(teamLogoSize), Math.round(teamLogoSize), { fit: "inside" })
				.png()
				.toBuffer();

			const logoAwayResized = await sharp(teamLogos[i * 2 + 1])
				.resize(Math.round(teamLogoSize), Math.round(teamLogoSize), { fit: "inside" })
				.png()
				.toBuffer();

			// Position team logos (better positioning)
			compositeOperations.push(
				// Home team logo (left)
				{
					input: logoHomeResized,
					left: Math.round(width * 0.12),
					top: Math.round(gameY + (gameHeight - teamLogoSize) / 2),
					blend: "over",
				},
				// Away team logo (right)
				{
					input: logoAwayResized,
					left: Math.round(width * 0.78),
					top: Math.round(gameY + (gameHeight - teamLogoSize) / 2),
					blend: "over",
				}
			);
		}

		// Composite all elements
		const finalImage = await baseImage.composite(compositeOperations).jpeg({ quality: 95 }).toBuffer();

		return finalImage;
	} catch (error) {
		logger.error("Error creating football schedule image:", error);
		throw error;
	}
}

// Helper function to create football-themed gradient background
function createFootballGradientBackground(width: number, height: number, color: string = "#1E3A8A"): Buffer {
	const baseColor = color.replace("#", "");
	const r = parseInt(baseColor.substring(0, 2), 16);
	const g = parseInt(baseColor.substring(2, 4), 16);
	const b = parseInt(baseColor.substring(4, 6), 16);

	const gradientSvg = `
		<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<radialGradient id="footballGrad" cx="50%" cy="30%">
					<stop offset="0%" style="stop-color:rgb(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(
		255,
		b + 40
	)});stop-opacity:1" />
					<stop offset="60%" style="stop-color:rgb(${r},${g},${b});stop-opacity:1" />
					<stop offset="100%" style="stop-color:rgb(${Math.max(0, r - 60)},${Math.max(0, g - 60)},${Math.max(
		0,
		b - 60
	)});stop-opacity:1" />
				</radialGradient>
				<pattern id="footballPattern" patternUnits="userSpaceOnUse" width="100" height="100" patternTransform="rotate(45)">
					<rect width="100" height="100" fill="url(#footballGrad)"/>
					<circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="2"/>
				</pattern>
			</defs>
			<rect width="100%" height="100%" fill="url(#footballPattern)" />
			<!-- Decorative side elements -->
			<rect x="0" y="0" width="8" height="100%" fill="rgba(0,255,0,0.6)" />
			<rect x="${width - 8}" y="0" width="8" height="100%" fill="rgba(0,255,0,0.6)" />
		</svg>
	`;

	return Buffer.from(gradientSvg);
}

// Helper function to create football schedule overlay
function createFootballScheduleOverlay(
	width: number,
	height: number,
	data: string,
	jogos: any[],
	whatsapp?: string
): string {
	// Enhanced responsive font sizes (much bigger)
	const titleFontSize = Math.min(width * 0.09, 140);
	const subtitleFontSize = Math.min(width * 0.03, 42);
	const teamFontSize = Math.min(width * 0.038, 52);
	const timeFontSize = Math.min(width * 0.028, 36);
	const channelFontSize = Math.min(width * 0.022, 28);
	const metaFontSize = Math.min(width * 0.032, 40);
	const watermarkFontSize = Math.min(width * 0.018, 22);

	const gameHeight = (height - 240) / Math.max(jogos.length, 1);
	const startY = 180;

	let svg = `
		<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<style>
					@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;900&display=swap');
					.title { 
						font-family: 'Roboto', 'Arial Black', Arial, sans-serif; 
						font-weight: 900; 
						fill: #00ff41; 
						text-shadow: 3px 3px 6px rgba(0,0,0,0.8);
						letter-spacing: 4px;
					}
					.subtitle { 
						font-family: 'Roboto', Arial, sans-serif; 
						font-weight: 700; 
						fill: white; 
						font-style: italic;
						text-shadow: 2px 2px 4px rgba(0,0,0,0.6);
					}
					.team { 
						font-family: 'Roboto', 'Arial Black', Arial, sans-serif; 
						font-weight: 900; 
						fill: white; 
						text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
						letter-spacing: 1px;
					}
					.time { 
						font-family: 'Roboto', 'Arial Black', Arial, sans-serif; 
						font-weight: 900; 
						fill: #000; 
						text-shadow: 1px 1px 2px rgba(255,255,255,0.3);
					}
					.channel { 
						font-family: 'Roboto', Arial, sans-serif; 
						fill: white; 
						font-weight: 700;
						text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
					}
					.vs { 
						font-family: 'Roboto', 'Arial Black', Arial, sans-serif; 
						font-weight: 900; 
						fill: #00ff41; 
						text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
					}
					.meta { 
						font-family: 'Roboto', Arial, sans-serif; 
						fill: white; 
						font-weight: 700;
						text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
					}
					.watermark { 
						font-family: 'Roboto', Arial, sans-serif; 
						fill: rgba(255,255,255,0.7); 
						font-weight: 500;
					}
					.date-text {
						font-family: 'Roboto', Arial, sans-serif; 
						font-weight: 900; 
						fill: #1E3A8A;
					}
				</style>
			</defs>
			
			<!-- Enhanced date box -->
			<rect x="30" y="30" width="140" height="80" rx="12" fill="rgba(255,255,255,0.95)" 
				  stroke="rgba(0,255,65,0.6)" stroke-width="3" />
			<text x="100" y="78" font-size="${timeFontSize + 4}" class="date-text" text-anchor="middle">${escapeXml(data)}</text>
			
			<!-- Enhanced main title with glow effect -->
			<text x="${width / 2}" y="100" font-size="${titleFontSize}" class="title" text-anchor="middle">PROGRAMAÇÃO</text>
			<text x="${width / 2}" y="140" font-size="${subtitleFontSize}" class="subtitle" text-anchor="middle">Futebol</text>
	`;

	// Add each game with enhanced styling
	jogos.forEach((jogo, index) => {
		const gameY = startY + index * gameHeight;
		const centerY = gameY + gameHeight / 2;

		// Enhanced game background with gradient and better shadow
		svg += `
			<defs>
				<linearGradient id="gameGrad${index}" x1="0%" y1="0%" x2="100%" y2="0%">
					<stop offset="0%" style="stop-color:rgba(0,0,0,0.7);stop-opacity:1" />
					<stop offset="50%" style="stop-color:rgba(0,0,0,0.85);stop-opacity:1" />
					<stop offset="100%" style="stop-color:rgba(0,0,0,0.7);stop-opacity:1" />
				</linearGradient>
				<filter id="gameShadow${index}" x="-10%" y="-10%" width="120%" height="120%">
					<feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="rgba(0,0,0,0.4)"/>
				</filter>
			</defs>
			<rect x="${width * 0.08}" y="${gameY + gameHeight * 0.15}" width="${width * 0.84}" height="${gameHeight * 0.7}" 
				  rx="20" fill="url(#gameGrad${index})" stroke="rgba(0,255,65,0.3)" stroke-width="2" 
				  filter="url(#gameShadow${index})"/>
		`;

		// Enhanced time display with better styling
		svg += `
			<rect x="${width * 0.1}" y="${gameY + gameHeight * 0.08}" width="120" height="40" rx="20" 
				  fill="linear-gradient(45deg, #ffff00, #ffd700)" stroke="rgba(0,0,0,0.3)" stroke-width="2"/>
			<text x="${width * 0.1 + 60}" y="${gameY + gameHeight * 0.08 + 28}" font-size="${timeFontSize}" 
				  class="time" text-anchor="middle">${escapeXml(jogo.horario)}</text>
		`;

		// Enhanced team names with better positioning
		svg += `
			<text x="${width * 0.32}" y="${centerY - 8}" font-size="${teamFontSize}" class="team" text-anchor="middle">
				${escapeXml(jogo.timeHome.toUpperCase())}
			</text>
			<text x="${width * 0.5}" y="${centerY - 5}" font-size="${teamFontSize * 1.2}" class="vs" text-anchor="middle">×</text>
			<text x="${width * 0.68}" y="${centerY + 8}" font-size="${teamFontSize}" class="team" text-anchor="middle">
				${escapeXml(jogo.timeAway.toUpperCase())}
			</text>
		`;

		// Enhanced channel info with better styling
		if (jogo.canal) {
			svg += `
				<rect x="${width * 0.35}" y="${centerY + 20}" width="${width * 0.3}" height="32" rx="16" 
					  fill="rgba(0,0,0,0.9)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
				<text x="${width * 0.5}" y="${centerY + 40}" font-size="${channelFontSize}" class="channel" text-anchor="middle">
					📺 ${escapeXml(jogo.canal)}
				</text>
			`;
		}
	});

	// Enhanced WhatsApp contact with better styling (much bigger)
	if (whatsapp) {
		svg += `
			<rect x="${width * 0.08}" y="${height - 110}" width="${width * 0.84}" height="70" rx="35" 
				  fill="linear-gradient(45deg, #25d366, #128c7e)" stroke="rgba(255,255,255,0.4)" stroke-width="3"/>
			<text x="${width / 2}" y="${height - 65}" font-size="${metaFontSize + 8}" class="meta" text-anchor="middle">
				📱 WhatsApp: ${escapeXml(whatsapp)}
			</text>
		`;
	}

	// Add watermark
	if (WATERMARK_ENABLED) {
		const watermarkY = whatsapp ? height - 130 : height - 60;
		svg += `
			<text x="${width - 20}" y="${watermarkY}" font-size="${watermarkFontSize}" class="watermark" text-anchor="end">
				${escapeXml(WATERMARK_TEXT)}
			</text>
		`;
	}

	svg += `</svg>`;
	return svg;
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

	// Football schedule generation endpoint
	app.post(
		"/generate-football-schedule",
		{
			schema: {
				tags: ["Football Schedule"],
				description: "Generate football/soccer schedule images for next day games (max 5 per image)",
				body: footballScheduleSchema,
				response: {
					200: footballScheduleResponseSchema,
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
					createFootballScheduleImage(data, resolutions.landscape.width, resolutions.landscape.height),
					createFootballScheduleImage(data, resolutions.portrait.width, resolutions.portrait.height),
					createFootballScheduleImage(data, resolutions.square.width, resolutions.square.height),
				]);

				// Save images and get download links
				const [landscapeLink, portraitLink, squareLink] = await Promise.all([
					saveImageAndGetLink(landscapeImage, `football_${sessionId}_landscape.jpg`, request),
					saveImageAndGetLink(portraitImage, `football_${sessionId}_portrait.jpg`, request),
					saveImageAndGetLink(squareImage, `football_${sessionId}_square.jpg`, request),
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
				logger.error("Error in football schedule generation:", error);
				return reply.code(500).send({
					success: false,
					error: "Failed to generate football schedule",
					message: error instanceof Error ? error.message : "Unknown error",
				});
			}
		}
	);

	// Football schedule example endpoint
	app.get(
		"/football-example",
		{
			schema: {
				tags: ["Football Schedule"],
				description: "Get example request body for football schedule generation",
				response: {
					200: z.object({
						example: footballScheduleSchema,
						usage: z.string(),
					}),
				},
			},
		},
		async (request, reply) => {
			const example = {
				logoEmpresaUrl: "https://via.placeholder.com/120x120/FF0000/FFFFFF?text=LOGO",
				fundoUrl: "https://via.placeholder.com/1920x1080/1E3A8A/000000?text=FUNDO",
				whatsapp: "+55 11 99999-9999",
				corFundo: "#1E3A8A",
				data: "19/06",
				jogos: [
					{
						timeHome: "PALMEIRAS",
						logoHomeUrl: "https://via.placeholder.com/80x80/00FF00/FFFFFF?text=PAL",
						timeAway: "AL AHLY",
						logoAwayUrl: "https://via.placeholder.com/80x80/FF0000/FFFFFF?text=AHL",
						horario: "13H00",
						canal: "SporTV",
					},
					{
						timeHome: "INTER MIAMI",
						logoHomeUrl: "https://via.placeholder.com/80x80/FFB6C1/000000?text=MIA",
						timeAway: "FC PORTO",
						logoAwayUrl: "https://via.placeholder.com/80x80/0000FF/FFFFFF?text=POR",
						horario: "19H00",
						canal: "SporTV",
					},
					{
						timeHome: "SEATTLE",
						logoHomeUrl: "https://via.placeholder.com/80x80/008000/FFFFFF?text=SEA",
						timeAway: "ATL MADRID",
						logoAwayUrl: "https://via.placeholder.com/80x80/DC143C/FFFFFF?text=ATM",
						horario: "19H00",
						canal: "SporTV",
					},
				],
			};

			return reply.code(200).send({
				example,
				usage:
					"POST /api/generate-football-schedule com o JSON acima no body. Máximo 5 jogos por imagem. Os campos 'fundoUrl', 'whatsapp' e 'canal' são opcionais.",
			});
		}
	);

	// Test football schedule route
	app.get(
		"/test-football-schedule",
		{
			schema: {
				tags: ["Football Schedule"],
				description: "Generate a test football schedule with random data",
				response: {
					200: footballScheduleResponseSchema,
				},
			},
		},
		async (request, reply) => {
			try {
				const randomTeams = [
					{ name: "PALMEIRAS", abbr: "PAL", color: "00FF00" },
					{ name: "FLAMENGO", abbr: "FLA", color: "FF0000" },
					{ name: "CORINTHIANS", abbr: "COR", color: "000000" },
					{ name: "SÃO PAULO", abbr: "SAO", color: "FF0000" },
					{ name: "SANTOS", abbr: "SAN", color: "FFFFFF" },
					{ name: "VASCO", abbr: "VAS", color: "000000" },
					{ name: "BOTAFOGO", abbr: "BOT", color: "000000" },
					{ name: "FLUMINENSE", abbr: "FLU", color: "008000" },
					{ name: "ATLETICO MG", abbr: "ATL", color: "000000" },
					{ name: "GREMIO", abbr: "GRE", color: "0000FF" },
				];

				const randomTimes = ["13H00", "15H00", "16H00", "17H00", "19H00", "20H00", "21H00", "22H00"];
				const randomChannels = ["SporTV", "Globo", "Band", "Record", "ESPN"];

				// Generate 3-5 random games
				const numGames = Math.floor(Math.random() * 3) + 3; // 3 to 5 games
				const jogos = [];

				for (let i = 0; i < numGames; i++) {
					const homeTeam = randomTeams[Math.floor(Math.random() * randomTeams.length)]!;
					let awayTeam = randomTeams[Math.floor(Math.random() * randomTeams.length)]!;

					// Make sure home and away teams are different
					while (awayTeam.name === homeTeam.name) {
						awayTeam = randomTeams[Math.floor(Math.random() * randomTeams.length)]!;
					}

					jogos.push({
						timeHome: homeTeam.name,
						logoHomeUrl: `http://fake-url-home-${i}.local/logo.png`,
						timeAway: awayTeam.name,
						logoAwayUrl: `http://fake-url-away-${i}.local/logo.png`,
						horario: randomTimes[Math.floor(Math.random() * randomTimes.length)]!,
						canal: Math.random() > 0.3 ? randomChannels[Math.floor(Math.random() * randomChannels.length)] : undefined,
					});
				}

				const testData = {
					logoEmpresaUrl: "http://fake-empresa-logo.local/logo.png",
					whatsapp: "+55 11 99999-9999",
					corFundo: "#1E3A8A",
					data: "19/06",
					jogos,
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
					createFootballScheduleImage(testData, resolutions.landscape.width, resolutions.landscape.height),
					createFootballScheduleImage(testData, resolutions.portrait.width, resolutions.portrait.height),
					createFootballScheduleImage(testData, resolutions.square.width, resolutions.square.height),
				]);

				// Save images and get download links
				const [landscapeLink, portraitLink, squareLink] = await Promise.all([
					saveImageAndGetLink(landscapeImage, `test_football_${sessionId}_landscape.jpg`, request),
					saveImageAndGetLink(portraitImage, `test_football_${sessionId}_portrait.jpg`, request),
					saveImageAndGetLink(squareImage, `test_football_${sessionId}_square.jpg`, request),
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
				logger.error("Error in test football schedule generation:", error);
				return reply.code(500).send({
					success: false,
					error: "Failed to generate test football schedule",
					message: error instanceof Error ? error.message : "Unknown error",
				});
			}
		}
	);
};
