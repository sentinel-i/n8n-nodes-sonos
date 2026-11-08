import { IExecuteFunctions, IHookFunctions, ILoadOptionsFunctions } from 'n8n-core';
import { OptionsWithUri } from 'request';
import { IDataObject, INodePropertyOptions } from 'n8n-workflow';

const API_BASE_URL = 'https://api.ws.sonos.com/control/api/v1/';

interface SonosItem {
	id: string;
	name?: string;
	description?: string;
	capabilities: string[];
}

export interface SonosPlayer {
	id: string;
	name: string;
	capabilities: string[];
}

export interface SonosGroup {
	id: string;
	name: string;
	coordinatorId: string;
	playbackState?: string;
	playerIds: string[];
}

interface SonosResponse {
	players?: SonosItem[];
	groups?: SonosItem[];
	households?: SonosItem[];
	items?: SonosItem[];
	playlists?: SonosItem[];
}

export interface SonosTopology {
	groups: SonosGroup[];
	players: SonosPlayer[];
}

export async function callSonosApi(
	this: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions,
	method: string,
	path: string,
	body?: IDataObject,
): Promise<SonosResponse & IDataObject> {
	if (!this || !this.helpers || !this.helpers.requestOAuth2) {
		throw Error();
	}
	const credentials = await this.getCredentials('sonosOAuth2Api');
	if (credentials === undefined) {
		throw new Error('No credentials got returned!');
	}

	const options: OptionsWithUri = {
		headers: {
			'Content-Type': 'application/json',
		},
		method,
		uri: API_BASE_URL + path.replace(/^\//, ''),
	};
	if (body !== undefined) {
		options.body = JSON.stringify(body);
	}

	//@ts-ignore
	const response = await this.helpers.requestOAuth2.call(this, 'sonosOAuth2Api', options);
	if (typeof response !== 'string') {
		return (response || {}) as SonosResponse & IDataObject;
	}
	return (response.trim() === '' ? {} : JSON.parse(response)) as SonosResponse & IDataObject;
}

/**
 * Loads the current groups and players of a household.
 * Group ids change every time the grouping changes, so this is fetched on every execution.
 */
export async function getTopology(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	household: string,
): Promise<SonosTopology> {
	let data;
	try {
		data = await callSonosApi.call(this, 'GET', `households/${household}/groups`);
	} catch (err) {
		throw new Error(`SONOS Error: ${err}`);
	}
	return {
		groups: (data.groups || []) as unknown as SonosGroup[],
		players: (data.players || []) as unknown as SonosPlayer[],
	};
}

function sameName(a: string | undefined, b: string): boolean {
	return (a || '').trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Finds a player by id or by name (case insensitive).
 */
export function findPlayer(topology: SonosTopology, reference: string): SonosPlayer | undefined {
	return (
		topology.players.find((player) => player.id === reference) ||
		topology.players.find((player) => sameName(player.name, reference))
	);
}

/**
 * Resolves a target to the group currently containing it.
 * The target can be a player id, a player name, a group id or a group name.
 * An empty target falls back to the first group found (behaviour of previous versions).
 */
export function resolveGroup(topology: SonosTopology, target: string): SonosGroup {
	const reference = (target || '').trim();
	if (reference === '') {
		if (topology.groups.length === 0) {
			throw new Error('No group found in this household');
		}
		return topology.groups[0];
	}

	const player = findPlayer(topology, reference);
	const group =
		(player && topology.groups.find((g) => g.playerIds.includes(player.id))) ||
		topology.groups.find((g) => g.id === reference) ||
		topology.groups.find((g) => sameName(g.name, reference));
	if (!group) {
		throw new Error(`No Sonos group or player found for "${reference}"`);
	}
	return group;
}

/**
 * Accepts a list coming from a multi-select field or an expression
 * (array, or comma separated string) and returns the trimmed, non-empty entries.
 */
export function toList(value: unknown): string[] {
	const list = Array.isArray(value) ? value : String(value ?? '').split(',');
	return list.map((entry) => String(entry).trim()).filter((entry) => entry !== '');
}

export function parseVolume(value: unknown): number {
	const volume = Number(value);
	if (value === '' || value === null || isNaN(volume) || volume < 0 || volume > 100) {
		throw new Error(`Invalid volume "${value}", expected a number between 0 and 100`);
	}
	return Math.round(volume);
}

export function describeGroup(topology: SonosTopology, group: SonosGroup): IDataObject {
	const playerName = (id: string) => findPlayer(topology, id)?.name || id;
	return {
		groupId: group.id,
		groupName: group.name,
		coordinator: playerName(group.coordinatorId),
		members: group.playerIds.map(playerName),
	};
}

function sameSet(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((id) => b.includes(id));
}

/**
 * Resolves player references (id or name) to player ids, in the given order.
 */
export function resolvePlayerIds(topology: SonosTopology, references: string[]): string[] {
	const playerIds: string[] = [];
	for (const reference of references) {
		const player = findPlayer(topology, reference);
		if (!player) {
			throw new Error(`No Sonos player found for "${reference}"`);
		}
		if (!playerIds.includes(player.id)) {
			playerIds.push(player.id);
		}
	}
	return playerIds;
}

/**
 * The players an action applies to, and the Sonos group they currently form.
 */
interface Zone {
	topology: SonosTopology;
	group: SonosGroup;
	playerIds: string[];
	regrouped: boolean;
}

/**
 * Makes sure the given players form exactly one group, alone.
 * Nothing is sent when they already do. Otherwise a group is created with exactly
 * these players: players not listed keep their own music, and the new group keeps
 * the music of the group the first player was in.
 */
async function ensureGroup(
	this: IExecuteFunctions,
	household: string,
	topology: SonosTopology,
	playerIds: string[],
): Promise<{ group: SonosGroup; regrouped: boolean }> {
	const current = topology.groups.find((g) => g.playerIds.includes(playerIds[0]));
	if (current && sameSet(current.playerIds, playerIds)) {
		return { group: current, regrouped: false };
	}

	const body: IDataObject = { playerIds };
	if (current) {
		body.musicContextGroupId = current.id;
	}
	const response = await callSonosApi.call(
		this,
		'POST',
		`households/${household}/groups/createGroup`,
		body,
	);
	let group = response.group as unknown as SonosGroup | undefined;
	if (!group || !group.id) {
		const refreshed = await getTopology.call(this, household);
		group = refreshed.groups.find((g) => sameSet(g.playerIds, playerIds));
	}
	if (!group) {
		throw new Error('Sonos could not group the selected players');
	}
	return {
		group: {
			...group,
			playerIds: group.playerIds || playerIds,
			playbackState: group.playbackState ?? current?.playbackState,
		},
		regrouped: true,
	};
}

/**
 * Finds the players an item applies to.
 * With the Players field, the players are grouped exactly as listed.
 * Workflows made with the former Group field target the group containing that player
 * (or the first group found), without regrouping.
 */
async function getZoneForItem(this: IExecuteFunctions, itemIndex: number): Promise<Zone> {
	const household = this.getNodeParameter('household', itemIndex) as string;
	const references = toList(this.getNodeParameter('players', itemIndex, []));
	const topology = await getTopology.call(this, household);

	if (references.length === 0) {
		const legacyTarget = this.getNodeParameter('target', itemIndex, '') as string;
		const group = resolveGroup(topology, legacyTarget);
		return { topology, group, playerIds: group.playerIds, regrouped: false };
	}

	const playerIds = resolvePlayerIds(topology, references);
	const { group, regrouped } = await ensureGroup.call(this, household, topology, playerIds);
	return { topology, group, playerIds, regrouped };
}

function describeZone(zone: Zone): IDataObject {
	return { ...describeGroup(zone.topology, zone.group), regrouped: zone.regrouped };
}

/**
 * Accepts one volume for every player ("30") or one volume per player ("30, 30, 20").
 */
export function parseVolumes(value: unknown, playerCount: number): number[] {
	const list = toList(value);
	if (list.length === 1) {
		const volume = parseVolume(list[0]);
		return Array.from({ length: playerCount }, () => volume);
	}
	if (list.length !== playerCount) {
		throw new Error(
			`Invalid volume "${value}", expected one volume or ${playerCount} volumes (one per player)`,
		);
	}
	return list.map(parseVolume);
}

/**
 * Shows a single number when every player has the same volume.
 */
function volumeOutput(volumes: number[] | undefined): number | number[] | undefined {
	if (!volumes) {
		return undefined;
	}
	return volumes.every((volume) => volume === volumes[0]) ? volumes[0] : volumes;
}

async function getPlayerVolumes(this: IExecuteFunctions, playerIds: string[]): Promise<number[]> {
	const volumes: number[] = [];
	for (const playerId of playerIds) {
		const current = await callSonosApi.call(this, 'GET', `players/${playerId}/playerVolume`);
		volumes.push(Number(current.volume ?? 0));
	}
	return volumes;
}

async function setPlayerVolumes(
	this: IExecuteFunctions,
	playerIds: string[],
	volumes: number[],
): Promise<void> {
	for (let index = 0; index < playerIds.length; index++) {
		await callSonosApi.call(this, 'POST', `players/${playerIds[index]}/playerVolume`, {
			volume: volumes[index],
		});
	}
}

async function applyOptionalVolume(
	this: IExecuteFunctions,
	itemIndex: number,
	playerIds: string[],
): Promise<number[] | undefined> {
	if (!this.getNodeParameter('setVolume', itemIndex, false)) {
		return undefined;
	}
	const volumes = parseVolumes(this.getNodeParameter('volume', itemIndex), playerIds.length);
	await setPlayerVolumes.call(this, playerIds, volumes);
	return volumes;
}

/**
 * Finds the id of a favorite or playlist from its id or its name.
 */
function resolveItemId(items: SonosItem[], reference: string, kind: string): SonosItem {
	const item =
		items.find((entry) => entry.id === reference) ||
		items.find((entry) => sameName(entry.name, reference));
	if (!item) {
		throw new Error(`No Sonos ${kind} found for "${reference}"`);
	}
	return item;
}

export async function playAudioClip(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const household = this.getNodeParameter('household', itemIndex) as string;
	const targets = toList(this.getNodeParameter('targets', itemIndex, []));
	// Workflows created with previous versions target a single player
	const legacyPlayer = this.getNodeParameter('player', itemIndex, '') as string;

	let playerIds: string[] = [];
	let playerNames: string[] = [];
	if (targets.length === 0 && legacyPlayer) {
		playerIds = [legacyPlayer];
		playerNames = [legacyPlayer];
	} else {
		if (targets.length === 0) {
			throw new Error('Select at least one player');
		}
		const topology = await getTopology.call(this, household);
		for (const target of targets) {
			// A player name or id targets that player only; a group name or id targets its players
			const player = findPlayer(topology, target);
			const targetIds = player ? [player.id] : resolveGroup(topology, target).playerIds;
			for (const playerId of targetIds) {
				const targetPlayer = findPlayer(topology, playerId);
				if (playerIds.includes(playerId)) continue;
				if (targetPlayer && !targetPlayer.capabilities.includes('AUDIO_CLIP')) continue;
				playerIds.push(playerId);
				playerNames.push(targetPlayer?.name || playerId);
			}
		}
	}

	const streamUrl = this.getNodeParameter('url', itemIndex) as string;
	const volume = parseVolume(this.getNodeParameter('volume', itemIndex));
	for (const playerId of playerIds) {
		await callSonosApi.call(this, 'POST', `players/${playerId}/audioClip`, {
			name: 'n8n',
			appId: 'com.n8n.sonos',
			streamUrl,
			clipType: 'CUSTOM',
			volume,
		});
	}
	return { players: playerNames, url: streamUrl, volume };
}

export async function groupAll(this: IExecuteFunctions): Promise<IDataObject> {
	const household = this.getNodeParameter('household', 0);
	const players = await loadPlayers.call(this);
	const playerIds = players.map((player) => player.value);
	const options: OptionsWithUri = {
		headers: {
			'Content-Type': 'application/json',
		},
		method: 'POST',
		body: JSON.stringify({
			playerIds,
		}),
		uri: API_BASE_URL + 'households/' + household + '/groups/createGroup',
	};
	await this.helpers.requestOAuth2.call(this, 'sonosOAuth2Api', options);
	return { members: players.map((player) => player.name) };
}

/**
 * Former "Group Players" action, kept so that workflows made with it still run.
 * Every group action now groups its players itself.
 */
export async function groupPlayers(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const household = this.getNodeParameter('household', itemIndex) as string;
	const topology = await getTopology.call(this, household);
	const playerIds = resolvePlayerIds(
		topology,
		toList(this.getNodeParameter('members', itemIndex, [])),
	);
	if (playerIds.length === 0) {
		throw new Error('Select at least one player');
	}
	const { group, regrouped } = await ensureGroup.call(this, household, topology, playerIds);
	return { changed: regrouped, ...describeGroup(topology, group) };
}

export const timing = {
	sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

const FADE_STEP_SECONDS = 2;
const MAX_FADE_SECONDS = 300;

export function parseFadeDuration(value: unknown): number {
	const seconds = Number(value ?? 0);
	if (isNaN(seconds) || seconds < 0 || seconds > MAX_FADE_SECONDS) {
		throw new Error(
			`Invalid fade duration "${value}", expected a number of seconds between 0 and ${MAX_FADE_SECONDS}`,
		);
	}
	return seconds;
}

function isPlaying(group: SonosGroup): boolean {
	return (
		group.playbackState === 'PLAYBACK_STATE_PLAYING' ||
		group.playbackState === 'PLAYBACK_STATE_BUFFERING'
	);
}

/**
 * Changes the volume of every player step by step (about every 2 seconds), all at the same
 * time, each one from its own start volume to its own target volume.
 */
async function rampVolumes(
	this: IExecuteFunctions,
	playerIds: string[],
	from: number[],
	to: number[],
	seconds: number,
): Promise<void> {
	if (from.every((volume, index) => volume === to[index])) {
		return;
	}
	const steps = Math.max(1, Math.round(seconds / FADE_STEP_SECONDS));
	for (let step = 1; step <= steps; step++) {
		await timing.sleep((seconds * 1000) / steps);
		for (let index = 0; index < playerIds.length; index++) {
			if (from[index] === to[index]) continue;
			const volume = Math.round(from[index] + ((to[index] - from[index]) * step) / steps);
			await callSonosApi.call(this, 'POST', `players/${playerIds[index]}/playerVolume`, {
				volume,
			});
		}
	}
}

/**
 * Lowers every player step by step down to 0, pauses, then gives each player its
 * volume back so the next playback starts at the usual level.
 * Returns the restored volumes, or undefined when no fade was done.
 */
async function fadeOutAndPause(
	this: IExecuteFunctions,
	zone: Zone,
	fadeSeconds: number,
): Promise<number[] | undefined> {
	if (fadeSeconds <= 0 || !isPlaying(zone.group)) {
		await callSonosApi.call(this, 'POST', `groups/${zone.group.id}/playback/pause`);
		return undefined;
	}

	const startVolumes = await getPlayerVolumes.call(this, zone.playerIds);
	const zeros = zone.playerIds.map(() => 0);
	await rampVolumes.call(this, zone.playerIds, startVolumes, zeros, fadeSeconds);
	await callSonosApi.call(this, 'POST', `groups/${zone.group.id}/playback/pause`);
	await setPlayerVolumes.call(this, zone.playerIds, startVolumes);
	return startVolumes;
}

/**
 * Loads new content (favorite or playlist) on a group.
 * With a fade duration, the current music fades out, the new content is loaded
 * at volume 0 and fades in up to the requested volumes (or the previous ones).
 */
async function loadContent(
	this: IExecuteFunctions,
	itemIndex: number,
	zone: Zone,
	path: string,
	body: IDataObject,
): Promise<number[] | undefined> {
	const fadeSeconds = parseFadeDuration(this.getNodeParameter('fadeDuration', itemIndex, 0));
	if (fadeSeconds <= 0) {
		const volumes = await applyOptionalVolume.call(this, itemIndex, zone.playerIds);
		await callSonosApi.call(this, 'POST', path, body);
		return volumes;
	}

	const requestedVolumes = this.getNodeParameter('setVolume', itemIndex, false)
		? parseVolumes(this.getNodeParameter('volume', itemIndex), zone.playerIds.length)
		: undefined;
	const currentVolumes = await getPlayerVolumes.call(this, zone.playerIds);
	const targetVolumes = requestedVolumes ?? currentVolumes;
	const zeros = zone.playerIds.map(() => 0);

	if (isPlaying(zone.group)) {
		await rampVolumes.call(this, zone.playerIds, currentVolumes, zeros, fadeSeconds);
	} else if (currentVolumes.some((volume) => volume !== 0)) {
		await setPlayerVolumes.call(this, zone.playerIds, zeros);
	}
	await callSonosApi.call(this, 'POST', path, body);
	await rampVolumes.call(this, zone.playerIds, zeros, targetVolumes, fadeSeconds);
	return targetVolumes;
}

export async function executeGroupAction(
	this: IExecuteFunctions,
	action: string,
	itemIndex: number,
): Promise<IDataObject> {
	const zone = await getZoneForItem.call(this, itemIndex);
	if (action === 'pause') {
		const fadeDuration = parseFadeDuration(this.getNodeParameter('fadeDuration', itemIndex, 0));
		const restoredVolume = await fadeOutAndPause.call(this, zone, fadeDuration);
		return { ...describeZone(zone), fadeDuration, restoredVolume: volumeOutput(restoredVolume) };
	}
	const volumes =
		action === 'play' ? await applyOptionalVolume.call(this, itemIndex, zone.playerIds) : undefined;
	await callSonosApi.call(this, 'POST', `groups/${zone.group.id}/playback/${action}`);
	return { ...describeZone(zone), volume: volumeOutput(volumes) };
}

function playModes(this: IExecuteFunctions, itemIndex: number): IDataObject {
	return {
		shuffle: this.getNodeParameter('shuffle', itemIndex),
		repeat: this.getNodeParameter('repeat', itemIndex),
		crossfade: this.getNodeParameter('crossfade', itemIndex),
	};
}

export async function playFavorite(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const household = this.getNodeParameter('household', itemIndex) as string;
	const favorites = await callSonosApi.call(this, 'GET', `households/${household}/favorites`);
	const favorite = resolveItemId(
		favorites.items || [],
		String(this.getNodeParameter('favorite', itemIndex)),
		'favorite',
	);
	const zone = await getZoneForItem.call(this, itemIndex);
	const volumes = await loadContent.call(
		this,
		itemIndex,
		zone,
		`groups/${zone.group.id}/favorites`,
		{
			action: 'replace',
			playOnCompletion: true,
			favoriteId: favorite.id,
			playModes: playModes.call(this, itemIndex),
		},
	);
	return { ...describeZone(zone), favorite: favorite.name, volume: volumeOutput(volumes) };
}

export async function playPlaylist(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const household = this.getNodeParameter('household', itemIndex) as string;
	const playlists = await callSonosApi.call(this, 'GET', `households/${household}/playlists`);
	const playlist = resolveItemId(
		playlists.playlists || [],
		String(this.getNodeParameter('playlist', itemIndex)),
		'playlist',
	);
	const zone = await getZoneForItem.call(this, itemIndex);
	const volumes = await loadContent.call(
		this,
		itemIndex,
		zone,
		`groups/${zone.group.id}/playlists`,
		{
			action: 'replace',
			playOnCompletion: true,
			playlistId: playlist.id,
			playModes: playModes.call(this, itemIndex),
		},
	);
	return { ...describeZone(zone), playlist: playlist.name, volume: volumeOutput(volumes) };
}

export async function setGroupVolume(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const zone = await getZoneForItem.call(this, itemIndex);
	const volumes = parseVolumes(this.getNodeParameter('volume', itemIndex), zone.playerIds.length);
	const fadeDuration = parseFadeDuration(this.getNodeParameter('fadeDuration', itemIndex, 0));
	if (fadeDuration > 0) {
		const currentVolumes = await getPlayerVolumes.call(this, zone.playerIds);
		await rampVolumes.call(this, zone.playerIds, currentVolumes, volumes, fadeDuration);
	} else {
		await setPlayerVolumes.call(this, zone.playerIds, volumes);
	}
	return { ...describeZone(zone), volume: volumeOutput(volumes), fadeDuration };
}

export async function loadPlayers(
	this: ILoadOptionsFunctions | IExecuteFunctions,
): Promise<INodePropertyOptions[]> {
	const returnData: INodePropertyOptions[] = [];
	const action = this.getNodeParameter('action', 0);

	let data;
	try {
		const household = this.getNodeParameter('household', 0);
		data = await callSonosApi.call(this, 'GET', `/households/${household}/groups`);
	} catch (err) {
		if (err.message === 'No credentials got returned!') {
			return returnData;
		}
		throw new Error(`SONOS Error: ${err}`);
	}

	for (const player of data.players!) {
		if (action === 'setHomeTheaterOptions' || action === 'loadHomeTheaterPlayback') {
			if (player.capabilities.includes('HT_PLAYBACK')) {
				returnData.push({
					name: player.name as string,
					value: player.id as string,
				});
			}
		} else if (action === 'setTVPowerState') {
			if (player.capabilities.includes('HT_POWER_STATE')) {
				returnData.push({
					name: player.name as string,
					value: player.id as string,
				});
			}
		} else {
			returnData.push({
				name: player.name as string,
				value: player.id as string,
			});
		}
	}
	return returnData;
}

/**
 * Lists the current groups. The stored value is the coordinator player id,
 * which stays valid when the group id changes after a regrouping.
 */
export async function loadGroups(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	let topology: SonosTopology;
	try {
		const household = this.getNodeParameter('household', 0) as string;
		topology = await getTopology.call(this, household);
	} catch (err) {
		if (err.message.includes('No credentials got returned!')) {
			return [];
		}
		throw err;
	}

	return topology.groups.map((group) => ({
		name: group.name,
		value: group.coordinatorId,
		description: (describeGroup(topology, group).members as string[]).join(', '),
	}));
}

export async function getFirstGroup(
	this: ILoadOptionsFunctions | IExecuteFunctions,
): Promise<string> {
	let data;
	try {
		const household = this.getNodeParameter('household', 0);
		data = await callSonosApi.call(this, 'GET', `/households/${household}/groups`);
	} catch (err) {
		throw new Error(`SONOS Error: ${err}`);
	}

	if (!data || !data.groups) {
		return '';
	}

	return data.groups[0].id;
}

export async function loadHouseholds(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const returnData: INodePropertyOptions[] = [];

	let data;
	try {
		data = await callSonosApi.call(this, 'GET', '/households');
	} catch (err) {
		if (err.message === 'No credentials got returned!') {
			return returnData;
		}
		throw new Error(`SONOS Error: ${err}`);
	}

	for (const household of data.households!) {
		returnData.push({
			name: household.id as string,
			value: household.id as string,
		});
	}
	return returnData;
}

export async function loadFavorites(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const returnData: INodePropertyOptions[] = [];
	const household = this.getNodeParameter('household', 0);

	let data;
	try {
		data = await callSonosApi.call(this, 'GET', '/households/' + household + '/favorites');
	} catch (err) {
		if (err.message === 'No credentials got returned!') {
			return returnData;
		}
		throw new Error(`SONOS Error: ${err}`);
	}

	for (const favorite of data.items!) {
		returnData.push({
			name: favorite.name as string,
			description: favorite.description as string,
			value: favorite.id as string,
		});
	}
	return returnData;
}

export async function loadPlaylists(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const returnData: INodePropertyOptions[] = [];
	const household = this.getNodeParameter('household', 0);

	let data;
	try {
		data = await callSonosApi.call(this, 'GET', '/households/' + household + '/playlists');
	} catch (err) {
		if (err.message === 'No credentials got returned!') {
			return returnData;
		}
		throw new Error(`SONOS Error: ${err}`);
	}

	for (const playlist of data.playlists || []) {
		returnData.push({
			name: playlist.name as string,
			value: playlist.id as string,
		});
	}
	return returnData;
}

export async function setTVPowerState(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const player = this.getNodeParameter('player', itemIndex);
	const tvPowerState = this.getNodeParameter('tvPowerState', itemIndex);
	await callSonosApi.call(this, 'POST', `players/${player}/homeTheater/tvPowerState`, {
		tvPowerState: tvPowerState ? 'ON' : 'STANDBY',
	});
	return { player, tvPowerState: tvPowerState ? 'ON' : 'STANDBY' };
}

export async function loadHomeTheaterPlayback(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const player = this.getNodeParameter('player', itemIndex);
	await callSonosApi.call(this, 'POST', `players/${player}/homeTheater`);
	return { player };
}

export async function setHomeTheaterOptions(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const player = this.getNodeParameter('player', itemIndex);
	const nightMode = this.getNodeParameter('nightMode', itemIndex);
	const enhanceDialog = this.getNodeParameter('enhanceDialog', itemIndex);
	await callSonosApi.call(this, 'POST', `players/${player}/homeTheater/options`, {
		enhanceDialog,
		nightMode,
	});
	return { player, nightMode, enhanceDialog };
}
