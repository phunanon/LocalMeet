import * as dotenv from 'dotenv';
import assert from 'assert';
import { ActionRowBuilder, ButtonInteraction, ButtonStyle } from 'discord.js';
import { ChannelType, CommandInteraction } from 'discord.js';
import { ComponentType, IntentsBitField, MessageFlags } from 'discord.js';
import { ModalBuilder, ModalSubmitInteraction } from 'discord.js';
import { Client, StringSelectMenuInteraction } from 'discord.js';
import { TextInputBuilder, TextInputStyle } from 'discord.js';
import { StringSelectMenuBuilder, Guild } from 'discord.js';
import { addUser, findNearest, userWhen } from './db';
import Fuse from 'fuse.js';
import { countries, TCountryCode } from 'countries-list';
const { floor, round } = Math;
dotenv.config();
const { DISCORD_TOKEN } = process.env;
assert(DISCORD_TOKEN, 'DISCORD_TOKEN is not defined');

const client = new Client({
  intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMembers],
  closeTimeout: 6_000,
});

client.on('interactionCreate', async x => {
  if (x.isCommand()) {
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
          ? 'Your city has been recorded successfully.'
          : 'There was an error. Try another search.',
        components: [],
      });
    }
  }
});

const findCitySelectedRole = async (guild: Guild) => {
  const roles = await guild.roles.fetch();
  const role = roles.find(x => x.name === 'City selected');
  return role ?? (await guild.roles.create({ name: 'City selected' }));
};

client.once('ready', async () => {
  console.log('Ready.');
  await client.application?.commands.create({
    name: 'find-city-here',
    description: 'City search in this channel.',
  });
  await client.application?.commands.create({
    name: 'find-nearby-here',
    description: 'People near you search in this channel.',
  });
  const guilds = await client.guilds.fetch();
  for (const [, guild] of guilds) {
    const fetched = await guild.fetch();
    if (!fetched) continue;
    await findCitySelectedRole(fetched);
  }
  console.log('Done.');
});

client.login(DISCORD_TOKEN);

const handleSearchHere = async (interaction: CommandInteraction) => {
  const { channel, guild } = interaction;
  if (!channel || !guild) return;
  if (channel.type !== ChannelType.GuildText) return;
  await channel.permissionOverwrites.create(guild.roles.everyone, {
    ViewChannel: true,
    SendMessages: false,
    AddReactions: false,
  });
  await channel.permissionOverwrites.create(interaction.client.user, {
    SendMessages: true,
  });
  await channel.send({
    content: `## First, let's find your city.`,
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
  await channel.permissionOverwrites.create(guild.roles.everyone, {
    ViewChannel: true,
    SendMessages: false,
    AddReactions: false,
  });
  await channel.permissionOverwrites.create(interaction.client.user, {
    SendMessages: true,
  });
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
  if (!guild || !member || !('_roles' in member)) {
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
        content: `You can change your city again <t:${canChangeIn}:R>.`,
        ephemeral: true,
      });
      return;
    }
  }

  const modal = new ModalBuilder()
    .setCustomId('city-search-modal')
    .setTitle('Search for your city')
    .setComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents([
        new TextInputBuilder()
          .setCustomId('search-input')
          .setLabel('Enter the name of your city')
          .setPlaceholder('We have a database of 125000 cities!')
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
  const cities = require('cities.json') as CitiesJson;
  const citySearcher = new Fuse(cities, { keys: ['name'] });
  return citySearcher.search(term, { limit }).map(x => x.item);
};

const handleSearchCitySubmit = async (interaction: ModalSubmitInteraction) => {
  await interaction.reply({
    content: 'Searching cities database...',
    ephemeral: true,
    flags: MessageFlags.SuppressEmbeds,
  });
  const { customId, member } = interaction;
  if (!customId || !member || !('_roles' in member)) return;
  const term = interaction.fields.getTextInputValue('search-input');

  const limit = 16;
  const cities = await findCities(term, limit);

  if (!cities.length) {
    await interaction.editReply('No cities found.');
    return;
  }

  type NameAndCode = { name: string; code: string };
  const admin1s = require('cities.json/admin1.json') as NameAndCode[];
  const admin2s = require('cities.json/admin2.json') as NameAndCode[];

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
- If you can't find your city, search for another city near to you
- You can click on them to confirm it is correct in Google Maps
- Once you've chosen your city, you won't be able to change it again for three months` +
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
      .setPlaceholder('Select your city')
      .setOptions(
        cityInfos.map((x, i) => ({
          label: `${x.label}`,
          value: `${x.lat},${x.lng}`,
        })),
      ),
  ]);
  await interaction.editReply({ content, components: [row] });
};

const handleCitySelect = async (x: StringSelectMenuInteraction) => {
  const { guild, member } = x;
  const latlng = x.values[0];
  if (!latlng || !guild || !member || !('_roles' in member)) return;
  const [latTxt, lngTxt] = latlng.split(',');
  if (!latTxt || !lngTxt) return;
  const lat = parseFloat(latTxt);
  const lng = parseFloat(lngTxt);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  await addUser(x.user.id, lat, lng);

  const role = await findCitySelectedRole(guild);
  await member.roles.add(role);

  return true;
};

const handleListNearby = async (interaction: ButtonInteraction) => {
  await interaction.deferReply({ ephemeral: true });
  const { guild, member } = interaction;
  if (!guild || !member) {
    await interaction.editReply('Error - try again later.');
    return;
  }

  const results = await findNearest(member.user.id, 10);
  if (!results) {
    await interaction.editReply(
      'You need to have searched for your city first.',
    );
    return;
  }
  const members = await guild.members.fetch();
  const { nearest, count } = results;
  const content =
    `The database of ${count} people was searched. Check back later to see if there's new people nearby!
## People nearest to you
` +
    nearest
      .map(({ sf, distance }) => {
        const user = members.get(sf);
        const tag = user ? ` (\`${user.user.tag}\`)` : ``;
        const km = (round(distance / 10) * 10).toLocaleString().padStart(5);
        return `- \`${km}\` km away - <@${sf}>${tag}`;
      })
      .join('\n');
  await interaction.editReply(content);
};
