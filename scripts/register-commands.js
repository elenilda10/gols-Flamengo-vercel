const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;

if (!applicationId || !botToken) {
  console.error("Defina DISCORD_APPLICATION_ID e DISCORD_BOT_TOKEN no ambiente local.");
  process.exit(1);
}

const commands = [
  {
    name: "ping",
    description: "Verifica se o bot está online",
    type: 1,
  },
  {
    name: "ajuda",
    description: "Mostra os comandos disponíveis",
    type: 1,
  },
];

const response = await fetch(
  `https://discord.com/api/v10/applications/${applicationId}/commands`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  },
);

const body = await response.text();
if (!response.ok) {
  console.error(`Discord API ${response.status}: ${body}`);
  process.exit(1);
}

console.log("Comandos registrados:", body);
