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

// Football schedule schema
const footballScheduleSchema = z.object({
	logoEmpresaUrl: z.string().url(),
	data: z.string(),
	jogos: z
		.array(
			z.object({
				timeHome: z.string(),
				logoHomeUrl: z.string().url(),
				timeAway: z.string(),
				logoAwayUrl: z.string().url(),
				horario: z.string(),
				canais: z
					.array(
						z.object({
							channelName: z.string(),
							logoUrl: z.string().url(),
						})
					)
					.optional(),
			})
		)
		.max(5),
	corFundo: z.string().optional(),
	fundoUrl: z.string().url().optional(),
	whatsapp: z.string().optional(),
});

// Query parameters schema
const footballQuerySchema = z.object({
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
const footballBase64ResponseSchema = z.object({
	success: z.boolean(),
	images: z.object({
		landscape: z.string(),
		portrait: z.string(),
		square: z.string(),
	}),
	message: z.string(),
});

// Response schema for file links
const footballFileResponseSchema = z.object({
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
const footballTestBase64ResponseSchema = z.object({
	success: z.boolean(),
	images: z.object({
		landscape: z.string(),
		portrait: z.string(),
		square: z.string(),
	}),
	message: z.string(),
	testData: z.any(),
});

const footballTestFileResponseSchema = z.object({
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

// Helper function to escape XML characters
function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

// Helper function to create game card background
function createGameCard(width: number, gameY: number, gameIndex: number, gameHeight: number = 120): string {
	return `
		<defs>
			<linearGradient id="gameGrad${gameIndex}" x1="0%" y1="0%" x2="100%" y2="0%">
				<stop offset="0%" style="stop-color:rgba(0,0,0,0.6);stop-opacity:1" />
				<stop offset="50%" style="stop-color:rgba(0,0,0,0.8);stop-opacity:1" />
				<stop offset="100%" style="stop-color:rgba(0,0,0,0.6);stop-opacity:1" />
			</linearGradient>
			<filter id="gameShadow${gameIndex}" x="-10%" y="-10%" width="120%" height="120%">
				<feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="rgba(0,0,0,0.5)"/>
			</filter>
		</defs>
		<rect x="${width * 0.05}" y="${gameY - 10}" width="${width * 0.9}" height="${gameHeight}" 
			  rx="25" fill="url(#gameGrad${gameIndex})" stroke="rgba(0,255,65,0.4)" stroke-width="2" 
			  filter="url(#gameShadow${gameIndex})"/>
	`;
}

// Helper function to create time display
function createTimeDisplay(centerX: number, gameY: number, horario: string, timeFontSize: number): string {
	return `
		<rect x="${centerX - 60}" y="${gameY + 5}" width="120" height="35" rx="18" 
			  fill="linear-gradient(45deg, #ffff00, #ffd700)" stroke="rgba(0,0,0,0.3)" stroke-width="2"/>
		<text x="${centerX}" y="${gameY + 28}" font-size="${timeFontSize}" 
			  class="time" text-anchor="middle">${escapeXml(horario)}</text>
	`;
}

// Helper function to create team display (logo + name)
function createTeamDisplay(
	teamName: string,
	x: number,
	y: number,
	teamFontSize: number,
	alignment: "left" | "center" | "right" = "center"
): string {
	const textAnchor = alignment === "left" ? "start" : alignment === "right" ? "end" : "middle";

	return `
		<text x="${x}" y="${y}" font-size="${teamFontSize}" class="team" text-anchor="${textAnchor}">
			${escapeXml(teamName.toUpperCase())}
		</text>
	`;
}

// Helper function to create VS symbol
function createVsSymbol(centerX: number, gameY: number, teamFontSize: number): string {
	return `
		<text x="${centerX}" y="${gameY + 70}" font-size="${teamFontSize * 1.1}" class="vs" text-anchor="middle">×</text>
	`;
}

// Helper function to create channel display
function createChannelDisplay(
	centerX: number,
	gameY: number,
	canais: { channelName: string; logoUrl: string }[],
	channelFontSize: number
): string {
	if (!canais || canais.length === 0) return "";

	const maxChannelsToShow = Math.min(canais.length, 3); // Show max 3 pairs
	const channelLogoSize = 20;

	// Calculate spacing for logo+text pairs
	const estimatedPairWidth = channelLogoSize + 5 + 60; // logo + gap + text space
	const totalWidth = maxChannelsToShow * estimatedPairWidth;
	const startX = centerX - totalWidth / 2;

	let channelSection = "";

	// Create background box for all channels
	const boxWidth = Math.max(200, totalWidth + 20);
	channelSection += `
		<rect x="${centerX - boxWidth / 2}" y="${gameY + 110}" width="${boxWidth}" height="28" rx="14" 
			  fill="rgba(0,0,0,0.9)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
	`;

	// Create individual channel name texts positioned next to their logos
	for (let i = 0; i < maxChannelsToShow; i++) {
		const textX = startX + i * estimatedPairWidth + channelLogoSize + 5; // Position after logo
		channelSection += `
			<text x="${textX}" y="${gameY + 128}" font-size="${channelFontSize * 0.8}" class="channel" text-anchor="start">
				${escapeXml(canais[i]!.channelName)}
			</text>
		`;
	}

	// Add "+X more" if there are more channels
	if (canais.length > maxChannelsToShow) {
		const moreText = `+${canais.length - maxChannelsToShow}`;
		channelSection += `
			<text x="${startX + maxChannelsToShow * estimatedPairWidth}" y="${gameY + 128}" font-size="${
			channelFontSize * 0.8
		}" class="channel" text-anchor="start">
				${moreText}
			</text>
		`;
	}

	return channelSection;
}

// Helper function to create header (title + date)
function createHeader(
	width: number,
	data: string,
	titleFontSize: number,
	dateFontSize: number,
	topMargin: number = 80
): string {
	return `
		<!-- Main title "JOGOS DO DIA" centered at top -->
		<text x="${
			width / 2
		}" y="${topMargin}" font-size="${titleFontSize}" class="main-title" text-anchor="middle">JOGOS DO DIA</text>
		
		<!-- Date centered below title -->
		<text x="${width / 2}" y="${
		topMargin + 60
	}" font-size="${dateFontSize}" class="date-title" text-anchor="middle">${escapeXml(data)}</text>
	`;
}

// Helper function to create contact section
function createContactSection(width: number, contactY: number, whatsapp: string, contactFontSize: number): string {
	return `
		<rect x="${width * 0.05}" y="${contactY}" width="${width * 0.9}" height="80" rx="40" 
			  fill="linear-gradient(45deg, #25d366, #128c7e)" stroke="rgba(255,255,255,0.4)" stroke-width="3"/>
		<text x="${width / 2}" y="${contactY + 50}" font-size="${contactFontSize}" class="contact" text-anchor="middle">
			📱 ${escapeXml(whatsapp)}
		</text>
	`;
}

// Helper function to create watermark
function createWatermark(width: number, height: number, watermarkFontSize: number): string {
	const watermarkY = height - 30;
	return `
		<text x="${width / 2}" y="${watermarkY}" font-size="${watermarkFontSize}" class="watermark" text-anchor="middle">
			${escapeXml(WATERMARK_TEXT)}
		</text>
	`;
}

// Helper function to create complete game section
function createGameSection(
	width: number,
	gameY: number,
	gameIndex: number,
	jogo: any,
	teamFontSize: number,
	timeFontSize: number,
	channelFontSize: number
): string {
	const centerX = width / 2;
	let gameSection = "";

	// Add game card background
	gameSection += createGameCard(width, gameY, gameIndex);

	// Add time display
	gameSection += createTimeDisplay(centerX, gameY, jogo.horario, timeFontSize);

	// Add horizontal team layout: logo1 team1 × team2 logo2
	// Left side: Home team logo + name
	gameSection += createTeamDisplay(jogo.timeHome, width * 0.18, gameY + 65, teamFontSize, "left");

	// Center: VS symbol
	gameSection += createVsSymbol(centerX, gameY, teamFontSize);

	// Right side: Away team name + logo
	gameSection += createTeamDisplay(jogo.timeAway, width * 0.82, gameY + 65, teamFontSize, "right");

	// Add channel display if available
	if (jogo.canais && jogo.canais.length > 0) {
		gameSection += createChannelDisplay(centerX, gameY, jogo.canais, channelFontSize);
	}

	return gameSection;
}

// Main helper function to create football schedule overlay (now simplified)
function createFootballScheduleOverlay(
	width: number,
	height: number,
	data: string,
	jogos: any[],
	whatsapp?: string
): string {
	// Enhanced responsive font sizes for portrait layout
	const titleFontSize = Math.min(width * 0.12, 80);
	const dateFontSize = Math.min(width * 0.08, 60);
	const teamFontSize = Math.min(width * 0.06, 45);
	const timeFontSize = Math.min(width * 0.05, 38);
	const channelFontSize = Math.min(width * 0.04, 30);
	const contactFontSize = Math.min(width * 0.07, 50);
	const watermarkFontSize = Math.min(width * 0.03, 24);

	// Calculate layout spacing for portrait
	const topMargin = 80;
	const gameStartY = 200;
	const gameSpacing = 180;
	const contactY = gameStartY + jogos.length * gameSpacing + 60;

	let svg = `
		<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<style>
					.main-title { 
						font-family: 'Arial Black', Arial, sans-serif; 
						font-weight: 900; 
						fill: #00ff41; 
						text-shadow: 3px 3px 6px rgba(0,0,0,0.8);
						letter-spacing: 3px;
					}
					.date-title { 
						font-family: 'Arial Black', Arial, sans-serif; 
						font-weight: 900; 
						fill: white; 
						text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
						letter-spacing: 2px;
					}
					.team { 
						font-family: 'Arial Black', Arial, sans-serif; 
						font-weight: 900; 
						fill: white; 
						text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
						letter-spacing: 1.5px;
					}
					.time { 
						font-family: 'Arial Black', Arial, sans-serif; 
						font-weight: 900; 
						fill: #000; 
						text-shadow: 1px 1px 2px rgba(255,255,255,0.3);
					}
					.channel { 
						font-family: Arial, sans-serif; 
						fill: white; 
						font-weight: 700;
						text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
					}
					.vs { 
						font-family: 'Arial Black', Arial, sans-serif; 
						font-weight: 900; 
						fill: #00ff41; 
						text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
					}
					.contact { 
						font-family: 'Arial Black', Arial, sans-serif; 
						fill: white; 
						font-weight: 900;
						text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
						letter-spacing: 1px;
					}
					.watermark { 
						font-family: Arial, sans-serif; 
						fill: rgba(255,255,255,0.6); 
						font-weight: 500;
					}
				</style>
			</defs>
	`;

	// Add header (title + date)
	svg += createHeader(width, data, titleFontSize, dateFontSize, topMargin);

	// Add each game section
	jogos.forEach((jogo, index) => {
		const gameY = gameStartY + index * gameSpacing;
		svg += createGameSection(width, gameY, index, jogo, teamFontSize, timeFontSize, channelFontSize);
	});

	// Add contact section if WhatsApp is provided
	if (whatsapp) {
		svg += createContactSection(width, contactY, whatsapp, contactFontSize);
	}

	// Add watermark
	if (WATERMARK_ENABLED) {
		svg += createWatermark(width, height, watermarkFontSize);
	}

	svg += `</svg>`;
	return svg;
}

// Helper function to create team logo composite operations
function createTeamLogoComposite(
	teamLogos: Buffer[],
	gameIndex: number,
	gameY: number,
	width: number,
	teamLogoSize: number = 70,
	positioning: "sides" | "inline" = "sides"
): Promise<any[]> {
	const operations: any[] = [];

	if (positioning === "sides") {
		// Position logos on the sides (current behavior)
		return Promise.all([
			sharp(teamLogos[gameIndex * 2])
				.resize(Math.round(teamLogoSize), Math.round(teamLogoSize), { fit: "inside" })
				.png()
				.toBuffer(),
			sharp(teamLogos[gameIndex * 2 + 1])
				.resize(Math.round(teamLogoSize), Math.round(teamLogoSize), { fit: "inside" })
				.png()
				.toBuffer(),
		]).then(([logoHomeResized, logoAwayResized]) => [
			// Home team logo (left side)
			{
				input: logoHomeResized,
				left: Math.round(width * 0.15),
				top: Math.round(gameY + 25),
				blend: "over",
			},
			// Away team logo (right side)
			{
				input: logoAwayResized,
				left: Math.round(width * 0.75),
				top: Math.round(gameY + 25),
				blend: "over",
			},
		]);
	} else {
		// Position logos inline with team names (horizontal layout)
		return Promise.all([
			sharp(teamLogos[gameIndex * 2])
				.resize(Math.round(teamLogoSize), Math.round(teamLogoSize), { fit: "inside" })
				.png()
				.toBuffer(),
			sharp(teamLogos[gameIndex * 2 + 1])
				.resize(Math.round(teamLogoSize), Math.round(teamLogoSize), { fit: "inside" })
				.png()
				.toBuffer(),
		]).then(([logoHomeResized, logoAwayResized]) => [
			// Home team logo (left side, before team name)
			{
				input: logoHomeResized,
				left: Math.round(width * 0.08),
				top: Math.round(gameY + 35),
				blend: "over",
			},
			// Away team logo (right side, after team name)
			{
				input: logoAwayResized,
				left: Math.round(width * 0.88),
				top: Math.round(gameY + 35),
				blend: "over",
			},
		]);
	}
}

// Helper function to create company logo composite
function createCompanyLogoComposite(
	logoBuffer: Buffer,
	logoSize: number,
	width: number,
	logoY: number,
	height: number,
	position: "bottom-center" | "top-right" = "bottom-center"
): Promise<any> {
	return sharp(logoBuffer)
		.resize(Math.round(logoSize), Math.round(logoSize), { fit: "cover" })
		.png()
		.toBuffer()
		.then((logoResized) => {
			if (position === "bottom-center") {
				return {
					input: logoResized,
					left: Math.round((width - logoSize) / 2),
					top: Math.min(logoY, height - logoSize - 60),
					blend: "over",
				};
			} else {
				// top-right positioning
				return {
					input: logoResized,
					left: width - Math.round(logoSize) - 30,
					top: 30,
					blend: "over",
				};
			}
		});
}

// Helper function to create channel logo composite operations
async function createChannelLogoComposite(
	canais: { channelName: string; logoUrl: string }[],
	gameY: number,
	width: number,
	channelLogoSize: number = 20
): Promise<any[]> {
	if (!canais || canais.length === 0) return [];

	const operations: any[] = [];
	const centerX = width / 2;
	const maxChannelsToShow = Math.min(canais.length, 3); // Show max 3 pairs

	// Calculate spacing for logo+text pairs
	const estimatedPairWidth = channelLogoSize + 5 + 60; // logo + gap + text space
	const totalWidth = maxChannelsToShow * estimatedPairWidth;
	const startX = centerX - totalWidth / 2;

	for (let i = 0; i < maxChannelsToShow; i++) {
		try {
			const channelLogo = await downloadImageWithFallback(
				canais[i]!.logoUrl,
				channelLogoSize,
				channelLogoSize,
				canais[i]!.channelName.substring(0, 2)
			);

			const logoResized = await sharp(channelLogo)
				.resize(channelLogoSize, channelLogoSize, { fit: "inside" })
				.png()
				.toBuffer();

			operations.push({
				input: logoResized,
				left: Math.round(startX + i * estimatedPairWidth),
				top: Math.round(gameY + 118), // Aligned with channel text
				blend: "over",
			});
		} catch (error) {
			logger.warn(`Failed to load channel logo for ${canais[i]!.channelName}:`, error);
		}
	}

	return operations;
}

// Main function to create football schedule image
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
				downloadImageWithFallback(jogo.logoHomeUrl, 100, 100, jogo.timeHome.substring(0, 3)),
				downloadImageWithFallback(jogo.logoAwayUrl, 100, 100, jogo.timeAway.substring(0, 3)),
			]);
			teamLogos.push(logoHome, logoAway);
		}

		// Resize company logo for bottom placement
		const logoSize = Math.min(width * 0.15, 120);
		const logoY = data.whatsapp ? 200 + data.jogos.length * 140 + 60 + 80 : 200 + data.jogos.length * 140 + 60 + 20;
		const companyLogoComposite = await createCompanyLogoComposite(
			logoEmpresaBuffer,
			logoSize,
			width,
			logoY,
			height,
			"bottom-center"
		);

		// Create the schedule overlay
		const scheduleOverlay = createFootballScheduleOverlay(width, height, data.data, data.jogos, data.whatsapp);

		// Calculate positioning for new centered layout
		const gameStartY = 200;
		const gameSpacing = 180;
		const contactY = gameStartY + data.jogos.length * gameSpacing + 60;

		// Create all composite operations
		const compositeOperations: any[] = [
			// Schedule overlay (background elements)
			{ input: Buffer.from(scheduleOverlay), blend: "over" },
			// Company logo at bottom center
			companyLogoComposite,
		];

		// Add team logos for each game - positioned to the sides of centered games
		for (let i = 0; i < data.jogos.length; i++) {
			const gameY = gameStartY + i * gameSpacing;
			const teamLogoSize = 70; // Fixed size for consistency

			// Resize team logos for this game
			const teamLogoOperations = await createTeamLogoComposite(teamLogos, i, gameY, width, teamLogoSize, "inline");

			// Position team logos on the sides of the centered game info
			compositeOperations.push(...teamLogoOperations);

			// Add channel logos if available
			if (data.jogos[i]!.canais && data.jogos[i]!.canais!.length > 0) {
				const channelLogoOperations = await createChannelLogoComposite(data.jogos[i]!.canais!, gameY, width, 20);
				compositeOperations.push(...channelLogoOperations);
			}
		}

		// Composite all elements
		const finalImage = await baseImage.composite(compositeOperations).jpeg({ quality: 95 }).toBuffer();

		return finalImage;
	} catch (error) {
		logger.error("Error creating football schedule image:", error);
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

export const footballRoutes: FastifyPluginAsyncZod = async (app) => {
	// Football schedule generation endpoint with flexible response format
	app.post(
		"/generate-football-schedule",
		{
			schema: {
				tags: ["Football Schedule"],
				description: "Generate football schedule images - Returns base64 or file links based on query params",
				body: footballScheduleSchema,
				querystring: footballQuerySchema,
				response: {
					200: z.union([footballBase64ResponseSchema, footballFileResponseSchema]),
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
					createFootballScheduleImage(data, resolutions.landscape.width, resolutions.landscape.height),
					createFootballScheduleImage(data, resolutions.portrait.width, resolutions.portrait.height),
					createFootballScheduleImage(data, resolutions.square.width, resolutions.square.height),
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
						message: "Football schedule images generated successfully (base64)",
					});
				} else {
					// Save files and return download links
					const sessionId = randomUUID();
					const [landscapeLink, portraitLink, squareLink] = await Promise.all([
						saveImageAndGetLink(landscapeImage, `football_${sessionId}_landscape.jpg`, request),
						saveImageAndGetLink(portraitImage, `football_${sessionId}_portrait.jpg`, request),
						saveImageAndGetLink(squareImage, `football_${sessionId}_square.jpg`, request),
					]);

					const downloads = {
						landscape: landscapeLink,
						portrait: portraitLink,
						square: squareLink,
					};

					return reply.code(200).send({
						success: true,
						downloads,
						message: "Football schedule images generated successfully (download links)",
						expiresIn: "1 hour",
					});
				}
			} catch (error) {
				logger.error("Error generating football schedule images:", error);
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

	// Download endpoint for football files
	app.get(
		"/download/:filename",
		{
			schema: {
				tags: ["Football Schedule"],
				description: "Download generated football schedule image",
				params: z.object({
					filename: z.string(),
				}),
			},
		},
		async (request, reply) => {
			try {
				const { filename } = request.params;
				const filePath = path.join(UPLOADS_DIR, filename);

				// Check if file exists
				await fs.access(filePath);

				// Set headers for download
				reply.header("Content-Disposition", `attachment; filename="${filename}"`);
				reply.header("Content-Type", "image/jpeg");

				// Stream the file
				const fileStream = await fs.readFile(filePath);
				return reply.send(fileStream);
			} catch (error) {
				logger.error("Error downloading file:", error);
				return reply.code(404).send({
					success: false,
					error: "File not found or expired",
					message: "The requested file does not exist or has expired",
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
			},
		},
		async (request, reply) => {
			const example = {
				logoEmpresaUrl: "https://payxyz.com.br/assets/logo-CjIdLj7R.png",
				data: "20/06/2025",
				fundoUrl: "https://m.media-amazon.com/images/I/6125nUqNQVL._UF1000,1000_QL80_.jpg",
				jogos: [
					{
						timeHome: "Flamengo",
						logoHomeUrl: "https://www.futebolnatv.com.br/upload/teams/680934bef5649e33691eae03c1989d23.png",
						timeAway: "Chelsea",
						logoAwayUrl: "https://www.futebolnatv.com.br/upload/teams/7a6f62bbdffe60afbf673bdcfaa8de47.png",
						horario: "15:00",
						canais: [
							{
								channelName: "SPORTV",
								logoUrl: "https://www.futebolnatv.com.br/upload/channel/Hz3KticAh1bRVvblrKfSv0k3xOQn2bYCW8kZojJC.png",
							},
							{
								channelName: "GLOBO PLAY",
								logoUrl: "https://www.futebolnatv.com.br/upload/channel/LG1vard6A9F2wjudSqkFJPQLtZZPuGV9hGievKqw.png",
							},
							{
								channelName: "DAZN",
								logoUrl: "https://www.futebolnatv.com.br/upload/channel/1573477190_dazn.png",
							},
						],
					},
					{
						timeHome: "Bayern",
						logoHomeUrl: "https://via.placeholder.com/120x120/FF0000/FFFFFF?text=BAY",
						timeAway: "Boca Juniors",
						logoAwayUrl: "https://via.placeholder.com/120x120/0000FF/FFFFFF?text=BOC",
						horario: "22:00",
						canais: [
							{
								channelName: "GLOBO",
								logoUrl: "https://www.futebolnatv.com.br/upload/channel/1573418008_globo.png",
							},
							{
								channelName: "SPORTV",
								logoUrl: "https://www.futebolnatv.com.br/upload/channel/Hz3KticAh1bRVvblrKfSv0k3xOQn2bYCW8kZojJC.png",
							},
							{
								channelName: "CAZÉ TV",
								logoUrl: "https://www.futebolnatv.com.br/upload/channel/19lBo0KozSs2G5KT2ZgJoCCy4AqZFQn01vc6HHvQ.png",
							},
						],
					},
				],
				whatsapp: "85997487096",
			};

			return reply.code(200).send({
				example,
				usage:
					"POST /api/generate-football-schedule com o JSON acima no body. Query params: ?base64=true (para base64) ou ?file=true (para links). Padrão é file=true. Máximo 5 jogos por imagem.",
			});
		}
	);

	// Test football schedule endpoint with query params support
	app.post(
		"/test-football-schedule",
		{
			schema: {
				tags: ["Football Schedule"],
				description: "Test football schedule generation with random data",
				querystring: footballQuerySchema,
				response: {
					200: z.union([footballTestBase64ResponseSchema, footballTestFileResponseSchema]),
				},
			},
		},
		async (request, reply) => {
			try {
				const query = request.query;

				// Determine response format (default to file if no params specified)
				const useBase64 = query.base64 === true;
				const useFile = query.file === true || (!query.base64 && !query.file);

				// Generate random test data
				const teams = [
					{ name: "FLAMENGO", abbr: "FLA", color: "FF0000" },
					{ name: "PALMEIRAS", abbr: "PAL", color: "008000" },
					{ name: "CORINTHIANS", abbr: "COR", color: "000000" },
					{ name: "SAO PAULO", abbr: "SAO", color: "FF0000" },
					{ name: "SANTOS", abbr: "SAN", color: "000000" },
					{ name: "FLUMINENSE", abbr: "FLU", color: "008000" },
					{ name: "ATLETICO MG", abbr: "ATL", color: "000000" },
					{ name: "GREMIO", abbr: "GRE", color: "0000FF" },
				];

				const randomTimes = ["14H00", "16H00", "18H30", "20H00", "21H30"];
				const randomChannels = [
					{ channelName: "GLOBO", logoUrl: "https://www.futebolnatv.com.br/upload/channel/1573418008_globo.png" },
					{
						channelName: "SPORTV",
						logoUrl: "https://www.futebolnatv.com.br/upload/channel/Hz3KticAh1bRVvblrKfSv0k3xOQn2bYCW8kZojJC.png",
					},
					{
						channelName: "ESPN",
						logoUrl: "https://www.futebolnatv.com.br/upload/channel/i7sbIjLJLzV3uhgPqM4F9wNbeh3LKaHywoUKvLdk.png",
					},
					{
						channelName: "GLOBO PLAY",
						logoUrl: "https://www.futebolnatv.com.br/upload/channel/LG1vard6A9F2wjudSqkFJPQLtZZPuGV9hGievKqw.png",
					},
					{ channelName: "DAZN", logoUrl: "https://www.futebolnatv.com.br/upload/channel/1573477190_dazn.png" },
					{
						channelName: "CAZÉ TV",
						logoUrl: "https://www.futebolnatv.com.br/upload/channel/19lBo0KozSs2G5KT2ZgJoCCy4AqZFQn01vc6HHvQ.png",
					},
					{
						channelName: "DISNEY+",
						logoUrl: "https://www.futebolnatv.com.br/upload/channel/9d8oug7pYHKlNmfc5wGnX2c1J6m5xkqqd5tqilbH.png",
					},
					{ channelName: "YOUTUBE", logoUrl: "https://www.futebolnatv.com.br/upload/channel/1573426975_youtube.png" },
				];

				const jogos = [];
				const numJogos = Math.floor(Math.random() * 4) + 2; // 2-5 jogos

				for (let i = 0; i < numJogos; i++) {
					const homeTeam = teams[Math.floor(Math.random() * teams.length)]!;
					let awayTeam = teams[Math.floor(Math.random() * teams.length)]!;
					while (awayTeam.name === homeTeam.name) {
						awayTeam = teams[Math.floor(Math.random() * teams.length)]!;
					}

					// Generate 1-4 random channels
					const numChannels = Math.floor(Math.random() * 4) + 1;
					const gameChannels: { channelName: string; logoUrl: string }[] = [];
					const shuffledChannels = [...randomChannels].sort(() => Math.random() - 0.5);
					for (let j = 0; j < numChannels; j++) {
						gameChannels.push(shuffledChannels[j]!);
					}

					jogos.push({
						timeHome: homeTeam.name,
						logoHomeUrl: `http://fake-url-home-${i}.local/logo.png`,
						timeAway: awayTeam.name,
						logoAwayUrl: `http://fake-url-away-${i}.local/logo.png`,
						horario: randomTimes[Math.floor(Math.random() * randomTimes.length)]!,
						canais: Math.random() > 0.2 ? gameChannels : undefined,
					});
				}

				const testData = {
					logoEmpresaUrl: "http://fake-company-logo.local/logo.png",
					corFundo: "#1E3A8A",
					data: "19/06",
					jogos,
				};

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
						message: "Test football schedule images generated successfully (base64)",
						testData,
					});
				} else {
					// Save files and return download links
					const sessionId = randomUUID();
					const [landscapeLink, portraitLink, squareLink] = await Promise.all([
						saveImageAndGetLink(landscapeImage, `test_football_${sessionId}_landscape.jpg`, request),
						saveImageAndGetLink(portraitImage, `test_football_${sessionId}_portrait.jpg`, request),
						saveImageAndGetLink(squareImage, `test_football_${sessionId}_square.jpg`, request),
					]);

					const downloads = {
						landscape: landscapeLink,
						portrait: portraitLink,
						square: squareLink,
					};

					return reply.code(200).send({
						success: true,
						downloads,
						message: "Test football schedule images generated successfully (download links)",
						expiresIn: "1 hour",
						testData,
					});
				}
			} catch (error) {
				logger.error("Error generating test football schedule:", error);
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
