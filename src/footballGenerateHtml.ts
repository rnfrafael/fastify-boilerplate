import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
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

// Football schedule schema (same as before)
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

// Generate CSS styles
function generateCSS(data: z.infer<typeof footballScheduleSchema>): string {
	const backgroundImage = data.fundoUrl
		? `url('${data.fundoUrl}')`
		: `linear-gradient(135deg, ${data.corFundo || "#1E3A8A"} 0%, #0F172A 100%)`;

	return `
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}

		body {
			width: 1080px;
			height: 1920px;
			background: ${backgroundImage};
			background-size: cover;
			background-position: center;
			font-family: 'Arial Black', Arial, sans-serif;
			color: white;
			display: flex;
			flex-direction: column;
			position: relative;
			overflow: hidden;
		}

		body::before {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: 
				radial-gradient(circle at 20% 20%, rgba(0,255,65,0.1) 0%, transparent 50%),
				radial-gradient(circle at 80% 80%, rgba(255,255,0,0.05) 0%, transparent 50%),
				linear-gradient(45deg, transparent 49%, rgba(0,255,65,0.02) 50%, transparent 51%);
			pointer-events: none;
			z-index: 1;
		}

		.container {
			flex: 1;
			display: grid;
			grid-template-rows: auto 1fr auto;
			padding: 40px;
			gap: 30px;
			min-height: 100vh;
			position: relative;
			z-index: 2;
		}

		.header {
			text-align: center;
			margin-bottom: 20px;
		}

		.title {
			font-size: 80px;
			font-weight: 900;
			color: #00ff41;
			text-shadow: 3px 3px 6px rgba(0,0,0,0.8);
			letter-spacing: 3px;
			margin-bottom: 10px;
		}

		.date {
			font-size: 60px;
			font-weight: 900;
			color: white;
			text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
			letter-spacing: 2px;
		}

		.games {
			display: grid;
			gap: 40px;
			flex: 1;
			grid-template-columns: 1fr;
			align-content: start;
			position: relative;
			z-index: 1;
		}

		.game-card {
			background: linear-gradient(90deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.8) 50%, rgba(0,0,0,0.6) 100%);
			border: 2px solid rgba(0,255,65,0.4);
			border-radius: 25px;
			padding: 20px;
			display: grid;
			grid-template-rows: auto auto auto;
			gap: 15px;
			box-shadow: 0 6px 20px rgba(0,0,0,0.5);
			backdrop-filter: blur(10px);
			position: relative;
			overflow: hidden;
		}

		.game-card::before {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			height: 4px;
			background: linear-gradient(90deg, #00ff41 0%, #ffff00 50%, #00ff41 100%);
		}

		.time-display {
			background: linear-gradient(45deg, #ffff00, #ffd700);
			color: #000;
			font-weight: 900;
			font-size: 38px;
			text-align: center;
			padding: 8px 20px;
			border-radius: 18px;
			border: 2px solid rgba(0,0,0,0.3);
			text-shadow: 1px 1px 2px rgba(255,255,255,0.3);
			align-self: center;
			min-width: 120px;
		}

		.teams {
			display: grid;
			grid-template-columns: 1fr auto 1fr;
			align-items: center;
			gap: 20px;
			padding: 0 20px;
		}

		.team {
			display: flex;
			align-items: center;
			gap: 15px;
			min-width: 0; /* Allow text truncation */
		}

		.team.home {
			flex-direction: row;
			justify-self: start;
		}

		.team.away {
			flex-direction: row-reverse;
			justify-self: end;
		}

		.vs {
			justify-self: center;
		}

		.team-logo {
			width: 70px;
			height: 70px;
			object-fit: contain;
			border-radius: 8px;
		}

		.team-name {
			font-size: 45px;
			font-weight: 900;
			text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
			letter-spacing: 1.5px;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			max-width: 300px;
		}

		.vs {
			font-size: 50px;
			font-weight: 900;
			color: #00ff41;
			text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
			padding: 10px;
			background: rgba(0,255,65,0.1);
			border-radius: 50%;
			min-width: 70px;
			text-align: center;
		}

		.channels {
			display: flex;
			align-items: center;
			justify-content: center;
			flex-wrap: wrap;
			gap: 20px;
			background: rgba(0,0,0,0.9);
			border: 1px solid rgba(255,255,255,0.3);
			border-radius: 14px;
			padding: 12px 20px;
			margin-top: 10px;
			backdrop-filter: blur(5px);
		}

		.channel-item {
			display: flex;
			align-items: center;
			gap: 8px;
			background: rgba(255,255,255,0.1);
			padding: 4px 8px;
			border-radius: 8px;
			transition: transform 0.2s ease;
		}

		.channel-item:hover {
			transform: scale(1.05);
		}

		.channel-logo {
			width: 20px;
			height: 20px;
			object-fit: contain;
		}

		.channel-name {
			font-size: 24px;
			font-weight: 700;
			text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
		}

		.contact {
			background: linear-gradient(45deg, #25d366, #128c7e);
			border: 3px solid rgba(255,255,255,0.4);
			border-radius: 40px;
			padding: 25px;
			text-align: center;
			font-size: 50px;
			font-weight: 900;
			text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
			letter-spacing: 1px;
			box-shadow: 0 8px 25px rgba(37, 211, 102, 0.3);
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 15px;
		}

		.company-logo {
			width: 100px;
			height: 100px;
			object-fit: cover;
			border-radius: 50%;
			border: 3px solid rgba(0,255,65,0.6);
			box-shadow: 
				0 4px 15px rgba(0,255,65,0.3),
				0 0 30px rgba(0,255,65,0.2),
				inset 0 0 20px rgba(0,255,65,0.1);
			position: absolute;
			top: 30px;
			right: 30px;
			z-index: 10;
			animation: logoGlow 3s ease-in-out infinite alternate;
		}

		@keyframes logoGlow {
			0% {
				box-shadow: 
					0 4px 15px rgba(0,255,65,0.3),
					0 0 30px rgba(0,255,65,0.2),
					inset 0 0 20px rgba(0,255,65,0.1);
			}
			100% {
				box-shadow: 
					0 6px 20px rgba(0,255,65,0.5),
					0 0 40px rgba(0,255,65,0.4),
					inset 0 0 25px rgba(0,255,65,0.2);
			}
		}

		.watermark {
			position: absolute;
			font-size: 18px;
			color: rgba(255,255,255,0.4);
			font-weight: 500;
			pointer-events: none;
			user-select: none;
		}

		.watermark.bottom-center {
			bottom: 20px;
			left: 50%;
			transform: translateX(-50%);
		}

		.watermark.top-left {
			top: 150px;
			left: 30px;
			transform: rotate(-90deg);
			transform-origin: left bottom;
		}

		.watermark.middle-left {
			top: 50%;
			left: 20px;
			transform: translateY(-50%) rotate(-90deg);
			transform-origin: center;
		}

		.watermark.middle-right {
			top: 50%;
			right: 20px;
			transform: translateY(-50%) rotate(90deg);
			transform-origin: center;
		}

		.watermark.diagonal-1 {
			top: 25%;
			left: 15%;
			transform: rotate(-45deg);
			opacity: 0.2;
		}

		.watermark.diagonal-2 {
			top: 75%;
			right: 15%;
			transform: rotate(45deg);
			opacity: 0.2;
		}

		.watermark.behind-games {
			position: absolute;
			font-size: 120px;
			color: rgba(255,255,255,0.03);
			font-weight: 900;
			z-index: 0;
			pointer-events: none;
			user-select: none;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%) rotate(-15deg);
			letter-spacing: 20px;
		}

		.watermark.between-games {
			position: relative;
			text-align: center;
			font-size: 14px;
			color: rgba(255,255,255,0.3);
			font-weight: 400;
			margin: 10px 0;
			letter-spacing: 2px;
		}

		.more-channels {
			font-size: 20px;
			color: #00ff41;
			font-weight: 700;
		}
	`;
}

// Generate HTML structure
function generateHTML(data: z.infer<typeof footballScheduleSchema>): string {
	const css = generateCSS(data);

	const gamesHTML = data.jogos
		.map(
			(jogo, index) => `
		<article class="game-card" aria-label="Jogo ${index + 1}">
			<div class="time-display" role="text" aria-label="Horário do jogo">
				${jogo.horario}
			</div>
			
			<div class="teams" role="group" aria-label="Times do jogo">
				<div class="team home" role="group" aria-label="Time da casa">
					<img src="${jogo.logoHomeUrl}" alt="Logo ${jogo.timeHome}" class="team-logo" />
					<h3 class="team-name">${jogo.timeHome.toUpperCase()}</h3>
				</div>
				
				<div class="vs" role="text" aria-label="versus">×</div>
				
				<div class="team away" role="group" aria-label="Time visitante">
					<h3 class="team-name">${jogo.timeAway.toUpperCase()}</h3>
					<img src="${jogo.logoAwayUrl}" alt="Logo ${jogo.timeAway}" class="team-logo" />
				</div>
			</div>
			
			${
				jogo.canais && jogo.canais.length > 0
					? `
				<div class="channels" role="group" aria-label="Canais de transmissão">
					${jogo.canais
						.slice(0, 3)
						.map(
							(canal) => `
						<div class="channel-item" role="text">
							<img src="${canal.logoUrl}" alt="Logo ${canal.channelName}" class="channel-logo" />
							<span class="channel-name">${canal.channelName}</span>
						</div>
					`
						)
						.join("")}
					${jogo.canais.length > 3 ? `<span class="more-channels">+${jogo.canais.length - 3} mais</span>` : ""}
				</div>
			`
					: ""
			}
		</article>
		${
			WATERMARK_ENABLED && index < data.jogos.length - 1
				? `<div class="watermark between-games" aria-hidden="true">• ${WATERMARK_TEXT} •</div>`
				: ""
		}
	`
		)
		.join("");

	return `
		<!DOCTYPE html>
		<html lang="pt-BR">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Jogos do Dia - ${data.data}</title>
			<style>${css}</style>
		</head>
		<body>
			<main class="container">
				<header class="header">
					<h1 class="title">JOGOS DO DIA</h1>
					<time class="date" datetime="${data.data}">${data.data}</time>
				</header>
				
				<section class="games" aria-label="Lista de jogos">
					<!-- Large background watermark behind games -->
					${WATERMARK_ENABLED ? `<div class="watermark behind-games" aria-hidden="true">${WATERMARK_TEXT}</div>` : ""}
					${gamesHTML}
				</section>
				
				${
					data.whatsapp
						? `
					<aside class="contact" aria-label="Contato WhatsApp">
						<span>📱</span>
						<span>${data.whatsapp}</span>
					</aside>
				`
						: ""
				}
				
				<!-- Company logo positioned absolutely in top-right -->
				<img src="${data.logoEmpresaUrl}" alt="Logo da empresa" class="company-logo" />
			</main>
			
			${
				WATERMARK_ENABLED
					? `
				<!-- Multiple watermarks positioned strategically -->
				<div class="watermark bottom-center" aria-hidden="true">${WATERMARK_TEXT}</div>
				<div class="watermark top-left" aria-hidden="true">${WATERMARK_TEXT}</div>
				<div class="watermark middle-left" aria-hidden="true">${WATERMARK_TEXT}</div>
				<div class="watermark middle-right" aria-hidden="true">${WATERMARK_TEXT}</div>
				<div class="watermark diagonal-1" aria-hidden="true">${WATERMARK_TEXT}</div>
				<div class="watermark diagonal-2" aria-hidden="true">${WATERMARK_TEXT}</div>
			`
					: ""
			}
		</body>
		</html>
	`;
}

// Convert HTML to image using Puppeteer
async function htmlToImage(html: string, width: number = 1080, height: number = 1920): Promise<Buffer> {
	try {
		// Import puppeteer dynamically to handle if it's not installed
		const puppeteer = await import("puppeteer").catch(() => null);

		if (!puppeteer) {
			logger.warn("Puppeteer not installed - returning HTML as buffer");
			return Buffer.from(html);
		}

		const browser = await puppeteer.launch({
			headless: true,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});

		try {
			const page = await browser.newPage();
			await page.setViewport({ width, height, deviceScaleFactor: 2 });
			await page.setContent(html, { waitUntil: "networkidle0" });

			const screenshot = await page.screenshot({
				type: "jpeg",
				quality: 95,
				fullPage: true,
			});

			return screenshot as Buffer;
		} finally {
			await browser.close();
		}
	} catch (error) {
		logger.error("Error converting HTML to image:", error);
		// Fallback to returning HTML as buffer
		return Buffer.from(html);
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

export const footballHtmlRoutes: FastifyPluginAsyncZod = async (app) => {
	// HTML-based football schedule generation endpoint
	app.post(
		"/generate-football-html",
		{
			schema: {
				tags: ["Football Schedule HTML"],
				description: "Generate football schedule images using HTML/CSS - Returns base64 or file links",
				body: footballScheduleSchema,
				querystring: z.object({
					base64: z
						.string()
						.optional()
						.transform((val) => val === "true"),
					file: z
						.string()
						.optional()
						.transform((val) => val === "true"),
				}),
			},
		},
		async (request, reply) => {
			try {
				const data = request.body;
				const query = request.query;

				// Determine response format (default to file if no params specified)
				const useBase64 = query.base64 === true;
				const useFile = query.file === true || (!query.base64 && !query.file);

				// Generate HTML
				const html = generateHTML(data);

				// Convert to image (portrait only for now)
				const imageBuffer = await htmlToImage(html, 1080, 1920);

				if (useBase64) {
					// Return base64 image
					return reply.code(200).send({
						success: true,
						image: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
						message: "Football schedule image generated successfully using HTML (base64)",
					});
				} else {
					// Save file and return download link
					const sessionId = randomUUID();
					const downloadLink = await saveImageAndGetLink(
						imageBuffer,
						`football_html_${sessionId}_portrait.jpg`,
						request
					);

					return reply.code(200).send({
						success: true,
						download: downloadLink,
						message: "Football schedule image generated successfully using HTML (download link)",
						expiresIn: "1 hour",
					});
				}
			} catch (error) {
				logger.error("Error generating HTML football schedule:", error);
				return reply.code(500).send({
					success: false,
					message: error instanceof Error ? error.message : "Unknown error",
				});
			}
		}
	);

	// HTML preview endpoint (for debugging)
	app.post(
		"/preview-football-html",
		{
			schema: {
				tags: ["Football Schedule HTML"],
				description: "Preview the HTML before converting to image",
				body: footballScheduleSchema,
			},
		},
		async (request, reply) => {
			try {
				const data = request.body;
				const html = generateHTML(data);

				reply.type("text/html");
				return reply.send(html);
			} catch (error) {
				logger.error("Error generating HTML preview:", error);
				return reply.code(500).send({
					success: false,
					message: error instanceof Error ? error.message : "Unknown error",
				});
			}
		}
	);

	// Example endpoint
	app.get(
		"/football-html-example",
		{
			schema: {
				tags: ["Football Schedule HTML"],
				description: "Get example request body for HTML-based football schedule generation",
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
						],
					},
				],
				whatsapp: "85997487096",
			};

			return reply.code(200).send({
				example,
				usage:
					"POST /api/generate-football-html com o JSON acima no body. Use /api/preview-football-html para ver o HTML antes da conversão.",
			});
		}
	);

	// Test endpoint with random data
	app.post(
		"/test-football-html",
		{
			schema: {
				tags: ["Football Schedule HTML"],
				description: "Test HTML-based football schedule generation with random data",
				querystring: z.object({
					base64: z
						.string()
						.optional()
						.transform((val) => val === "true"),
					file: z
						.string()
						.optional()
						.transform((val) => val === "true"),
				}),
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
				];

				const jogos = [];
				const numJogos = Math.floor(Math.random() * 3) + 2; // 2-4 jogos

				for (let i = 0; i < numJogos; i++) {
					const homeTeam = teams[Math.floor(Math.random() * teams.length)]!;
					let awayTeam = teams[Math.floor(Math.random() * teams.length)]!;
					while (awayTeam.name === homeTeam.name) {
						awayTeam = teams[Math.floor(Math.random() * teams.length)]!;
					}

					// Generate 1-3 random channels
					const numChannels = Math.floor(Math.random() * 3) + 1;
					const gameChannels: { channelName: string; logoUrl: string }[] = [];
					const shuffledChannels = [...randomChannels].sort(() => Math.random() - 0.5);
					for (let j = 0; j < numChannels; j++) {
						gameChannels.push(shuffledChannels[j]!);
					}

					jogos.push({
						timeHome: homeTeam.name,
						logoHomeUrl: "https://www.futebolnatv.com.br/upload/teams/680934bef5649e33691eae03c1989d23.png",
						timeAway: awayTeam.name,
						logoAwayUrl: "https://www.futebolnatv.com.br/upload/teams/7a6f62bbdffe60afbf673bdcfaa8de47.png",
						horario: randomTimes[Math.floor(Math.random() * randomTimes.length)]!,
						canais: Math.random() > 0.2 ? gameChannels : undefined,
					});
				}

				const testData = {
					logoEmpresaUrl: "https://payxyz.com.br/assets/logo-CjIdLj7R.png",
					fundoUrl: "https://m.media-amazon.com/images/I/6125nUqNQVL._UF1000,1000_QL80_.jpg",
					data: "19/12/2024",
					jogos,
					whatsapp: "85997487096",
				};

				// Generate HTML
				const html = generateHTML(testData);

				// Convert to image
				const imageBuffer = await htmlToImage(html, 1080, 1920);

				if (useBase64) {
					// Return base64 image
					return reply.code(200).send({
						success: true,
						image: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
						message: "Test HTML football schedule generated successfully (base64)",
						testData,
					});
				} else {
					// Save file and return download link
					const sessionId = randomUUID();
					const downloadLink = await saveImageAndGetLink(
						imageBuffer,
						`test_football_html_${sessionId}_portrait.jpg`,
						request
					);

					return reply.code(200).send({
						success: true,
						download: downloadLink,
						message: "Test HTML football schedule generated successfully (download link)",
						expiresIn: "1 hour",
						testData,
					});
				}
			} catch (error) {
				logger.error("Error generating test HTML football schedule:", error);
				return reply.code(500).send({
					success: false,
					message: error instanceof Error ? error.message : "Unknown error",
				});
			}
		}
	);
};
