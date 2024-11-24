import * as dotenv from 'dotenv';
import assert from 'assert';
import {
  ActionRowBuilder,
  ButtonInteraction,
  ButtonStyle,
  GuildMember,
} from 'discord.js';
import { ChannelType, CommandInteraction } from 'discord.js';
import { ComponentType, IntentsBitField, MessageFlags } from 'discord.js';
import { ModalBuilder, ModalSubmitInteraction } from 'discord.js';
import { Client, StringSelectMenuInteraction } from 'discord.js';
import { TextInputBuilder, TextInputStyle } from 'discord.js';
import { StringSelectMenuBuilder, Guild } from 'discord.js';
import { readFile } from 'fs/promises';
import { addUser, searchDatabase, userWhen } from './db.js';
import Fuse from 'fuse.js';
import { countries, TCountryCode } from 'countries-list';
import { RenderMap } from './map.js';
import { Worker } from 'worker_threads';
import path from 'path';
const { floor, round } = Math;
dotenv.config();
const { DISCORD_TOKEN } = process.env;
assert(DISCORD_TOKEN, 'DISCORD_TOKEN is not defined');

const client = new Client({
  intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMembers],
  closeTimeout: 6_000,
});
let generatingMap = false;

client.on('interactionCreate', async x => {
  if (x.isCommand()) {
    if (!x.guild) {
      await x.reply('This command is only available in guilds.');
      return;
    }
    const member = await x.guild.members.fetch(x.user.id);
    if (!member) {
      await x.reply('You are not in a guild.');
      return;
    }
    if (!IsModerator(x.guild, member, BigInt(x.user.id))) {
      await x.reply({
        content: 'You must be a moderator to use this command.',
        ephemeral: true,
      });
      return;
    }
    if (x.commandName === 'find-city-here')
      await x.reply({
        content: (await handleSearchHere(x)) ? 'Done.' : 'Errored.',
        ephemeral: true,
      });
    if (x.commandName === 'find-nearby-here')
      await x.reply({
        content: (await handleNearbyHere(x)) ? 'Done.' : 'Errored.',
        ephemeral: true,
      });
  }
  if (x.isButton()) {
    if (x.customId === 'search-cities') await handleSearchCities(x);
    if (x.customId === 'list-nearby') await handleListNearby(x);
  }
  if (x.isModalSubmit()) {
    if (x.customId === 'city-search-modal') await handleSearchCitySubmit(x);
  }
  if (x.isStringSelectMenu()) {
    if (x.customId === 'city-select') {
      await x.update({
        content: (await handleCitySelect(x))
          ? 'Your town/city has been recorded successfully.'
          : 'There was an error. Try another search.',
        components: [],
      });
    }
  }
});

client.once('ready', async () => {
  console.log('Loading...');
  await client.application?.commands.create({
    name: 'find-city-here',
    description: 'City search in this channel.',
  });
  await client.application?.commands.create({
    name: 'find-nearby-here',
    description: 'People near you search in this channel.',
  });
  console.log('Ready.');
});

client.login(DISCORD_TOKEN);

const handleSearchHere = async (interaction: CommandInteraction) => {
  const { channel, guild } = interaction;
  if (!channel || !guild) return;
  if (channel.type !== ChannelType.GuildText) return;
  await channel.send({
    content: `## First, let's find your town or city.`,
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Primary,
            label: 'Start search',
            customId: 'search-cities',
          },
        ],
      },
    ],
  });
  return true;
};

const nearbyIntro = `## Second, let's find people near you.`;
const handleNearbyHere = async (interaction: CommandInteraction) => {
  const { channel, guild } = interaction;
  if (!channel || !guild) return;
  if (channel.type !== ChannelType.GuildText) return;
  await channel.send({
    content: nearbyIntro,
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Success,
            label: 'See latest list',
            customId: 'list-nearby',
          },
        ],
      },
    ],
  });
  return true;
};

const handleSearchCities = async (interaction: ButtonInteraction) => {
  const { guild, member } = interaction;
  if (!guild || !member) {
    await interaction.reply({
      content: 'Error - try again later.',
      ephemeral: true,
    });
    return;
  }
  const addedWhen = await userWhen(interaction.user.id);
  if (addedWhen) {
    const oneMonth = 30 * 24 * 60 * 60_000;
    const threeMonthsAgo = new Date(Date.now() - 3 * oneMonth);
    const canChangeIn = floor(
      new Date(addedWhen.getTime() + 3 * oneMonth).getTime() / 1000,
    );
    if (addedWhen && addedWhen > threeMonthsAgo) {
      await interaction.reply({
        content: `You can change your town/city again <t:${canChangeIn}:R>.`,
        ephemeral: true,
      });
      return;
    }
  }

  const modal = new ModalBuilder()
    .setCustomId('city-search-modal')
    .setTitle('Search for your town/city')
    .setComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents([
        new TextInputBuilder()
          .setCustomId('search-input')
          .setLabel('Enter the name of your town/city')
          .setPlaceholder('We have a database of 125000 towns & cities!')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ]),
    );
  await interaction.showModal(modal);
  return true;
};

const findCities = async (term: string, limit: number) => {
  type CitiesJson = {
    name: string;
    lat: string;
    lng: string;
    country: string;
    admin1: string;
    admin2: string;
  }[];
  const json = await readFile('node_modules/cities.json/cities.json');
  const cities = JSON.parse(json.toString()) as CitiesJson;
  const citySearcher = new Fuse(cities, { keys: ['name'] });
  return citySearcher.search(term, { limit }).map(x => x.item);
};

const handleSearchCitySubmit = async (interaction: ModalSubmitInteraction) => {
  await interaction.reply({
    content: 'Searching cities database...',
    ephemeral: true,
    flags: MessageFlags.SuppressEmbeds,
  });
  const { customId } = interaction;
  if (!customId) return;
  const term = interaction.fields.getTextInputValue('search-input');

  const limit = 16;
  const cities = await findCities(term, limit);

  if (!cities.length) {
    await interaction.editReply('No cities found.');
    return;
  }

  type NameAndCode = { name: string; code: string };
  const admin1Json = await readFile('node_modules/cities.json/admin1.json');
  const admin2Json = await readFile('node_modules/cities.json/admin2.json');
  const admin1s = JSON.parse(admin1Json.toString()) as NameAndCode[];
  const admin2s = JSON.parse(admin2Json.toString()) as NameAndCode[];

  const cityInfos = cities.map(
    ({ name, lat, lng, country, admin1, admin2 }, i) => {
      const url = `https://maps.google.com/?ll=${lat},${lng}&z=12`;
      const countryName = countries[country as TCountryCode]?.name;
      const major = admin1s.find(a => a.code === `${country}.${admin1}`);
      const minor = admin2s.find(
        a => a.code === `${major?.code}.${admin2}`,
      )?.name;
      const location = [minor, major?.name].filter(Boolean).join(', ');
      const locationAndCountry = [minor, major?.name, countryName]
        .filter(Boolean)
        .join(', ');
      return {
        country,
        lat,
        lng,
        urlLabel: `**[${name}](${url})** in ${location}`,
        label: `${name} in ${locationAndCountry}`,
      };
    },
  );
  const infosByCountry = cityInfos.reduce((acc, x) => {
    if (!acc[x.country]) acc[x.country] = [];
    acc[x.country]!.push(x);
    return acc;
  }, {} as Record<string, typeof cityInfos>);

  const content =
    `## Search results
- If you can't find your town/city, search for another town/city near to you
- You can click on them to confirm it is correct in Google Maps
- Once you've chosen your town/city, you won't be able to change it again for three months` +
    Object.entries(infosByCountry).map(([country, infos]) => {
      return (
        `
### ${countries[country as TCountryCode]?.name}
` + infos.map(x => x.urlLabel).join('\n')
      );
    });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents([
    new StringSelectMenuBuilder()
      .setCustomId('city-select')
      .setPlaceholder('Select your town/city')
      .setOptions(
        cityInfos.map((x, i) => ({
          label: `${x.label}`,
          value: `${x.lat},${x.lng}`,
        })),
      ),
  ]);
  await interaction.editReply({ content, components: [row] });
};

const handleCitySelect = async (interaction: StringSelectMenuInteraction) => {
  const { guild } = interaction;
  const latlng = interaction.values[0];
  if (!latlng || !guild) return;
  const [latTxt, lngTxt] = latlng.split(',');
  if (!latTxt || !lngTxt) return;
  const lat = parseFloat(latTxt);
  const lng = parseFloat(lngTxt);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  await addUser(interaction.user.id, lat, lng);

  return true;
};

const handleListNearby = async (interaction: ButtonInteraction) => {
  await interaction.deferReply({ ephemeral: true });

  const { guild, member } = interaction;
  if (!guild || !member) {
    await interaction.editReply('Error - try again later.');
    return;
  }

  const results = await searchDatabase(member.user.id);
  if (!results) {
    await interaction.editReply(
      'You need to have searched for your town/city first.',
    );
    return;
  }
  const N = 10;
  const members = await guild.members.fetch();
  const nearest: { sf: string; distance: number; tag: string }[] = [];
  for (const { sf, distance } of results) {
    const member = members.get(sf);
    if (member) nearest.push({ sf, distance, tag: member.user.tag });
    if (nearest.length >= N) break;
  }
  const content =
    `Searched ${results.length.toLocaleString()} people. Check again later to see new people nearby!
## People nearest to you
` +
    nearest
      .map(({ sf, distance, tag }) => {
        const km = (round(distance / 10) * 10).toLocaleString().padStart(5);
        return `- \`${km}\` km away - <@${sf}> (\`${tag}\`)`;
      })
      .join('\n');
  await interaction.editReply(content);

  await CallMapWorker(interaction, results);
};

async function CallMapWorker(
  interaction: ButtonInteraction,
  coords: { lat: number; lng: number }[],
) {
  if (generatingMap) return;
  generatingMap = true;
  try {
    const attachment = await new Promise<string>((resolve, reject) => {
      const worker = new Worker(path.resolve('./out/map-worker.js'), {
        workerData: coords,
      });
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', code => {
        if (code !== 0)
          reject(new Error(`Worker stopped with exit code ${code}`));
      });
    });

    await interaction.message.edit({
      files: [{ attachment, name: 'map.png' }],
    });
  } finally {
    generatingMap = false;
  }
}

const IsModerator = (guild: Guild, member: GuildMember, userSf: bigint) =>
  (BigInt(guild.ownerId) === userSf ||
    (guild.members.me &&
      member.roles.highest.position >=
        guild.members.me.roles.highest.position)) ??
  false;
