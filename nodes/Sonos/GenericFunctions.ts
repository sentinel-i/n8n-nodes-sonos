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

async function getGroupForItem(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<{ topology: SonosTopology; group: SonosGroup }> {
	const household = this.getNodeParameter('household', itemIndex) as string;
	const target = this.getNodeParameter('target', itemIndex, '') as string;
	const topology = await getTopology.call(this, household);
	return { topology, group: resolveGroup(topology, target) };
}

async function applyOptionalVolume(
	this: IExecuteFunctions,
	itemIndex: number,
	groupId: string,
): Promise<number | undefined> {
	if (!this.getNodeParameter('setVolume', itemIndex, false)) {
		return undefined;
	}
	const volume = parseVolume(this.getNodeParameter('volume', itemIndex));
	await callSonosApi.call(this, 'POST', `groups/${groupId}/groupVolume`, { volume });
	return volume;
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
			throw new Error('Select at least one target');
		}
		const topology = await getTopology.call(this, household);
		for (const target of targets) {
			for (const playerId of resolveGroup(topology, target).playerIds) {
				const player = findPlayer(topology, playerId);
				if (playerIds.includes(playerId)) continue;
				if (player && !player.capabilities.includes('AUDIO_CLIP')) continue;
				playerIds.push(playerId);
				playerNames.push(player?.name || playerId);
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
 * Makes sure the selected players form exactly one group.
 * Nothing is sent when the group already has the right members.
 */
export async function groupPlayers(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const household = this.getNodeParameter('household', itemIndex) as string;
	const topology = await getTopology.call(this, household);
	const members = toList(this.getNodeParameter('members', itemIndex, [])).map((reference) => {
		const player = findPlayer(topology, reference);
		if (!player) {
			throw new Error(`No Sonos player found for "${reference}"`);
		}
		return player;
	});
	if (members.length === 0) {
		throw new Error('Select at least one player');
	}

	const playerIds = members.map((player) => player.id);
	const currentGroup = topology.groups.find((g) => g.playerIds.includes(playerIds[0]));
	const alreadyGrouped =
		currentGroup !== undefined &&
		currentGroup.playerIds.length === playerIds.length &&
		playerIds.every((id) => currentGroup.playerIds.includes(id));

	if (alreadyGrouped) {
		return { changed: false, ...describeGroup(topology, currentGroup!) };
	}

	const body: IDataObject = { playerIds };
	if (currentGroup) {
		// Keep the music currently playing on the group of the first player
		body.musicContextGroupId = currentGroup.id;
	}
	const response = await callSonosApi.call(
		this,
		'POST',
		`households/${household}/groups/createGroup`,
		body,
	);
	const newGroup = response.group as unknown as SonosGroup | undefined;
	return {
		changed: true,
		...(newGroup && newGroup.playerIds
			? describeGroup(topology, newGroup)
			: { members: members.map((player) => player.name) }),
	};
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

async function getGroupVolume(this: IExecuteFunctions, groupId: string): Promise<number> {
	const current = await callSonosApi.call(this, 'GET', `groups/${groupId}/groupVolume`);
	return Number(current.volume ?? 0);
}

/**
 * Changes the group volume step by step (about every 2 seconds) from one value to another.
 */
async function rampVolume(
	this: IExecuteFunctions,
	groupId: string,
	from: number,
	to: number,
	seconds: number,
): Promise<void> {
	if (from === to) {
		return;
	}
	const steps = Math.max(1, Math.round(seconds / FADE_STEP_SECONDS));
	for (let step = 1; step <= steps; step++) {
		await timing.sleep((seconds * 1000) / steps);
		const volume = Math.round(from + ((to - from) * step) / steps);
		await callSonosApi.call(this, 'POST', `groups/${groupId}/groupVolume`, { volume });
	}
}

/**
 * Lowers the group volume step by step down to 0, pauses, then restores the
 * original volume so the next playback starts at the usual level.
 * Returns the restored volume, or undefined when no fade was done.
 */
async function fadeOutAndPause(
	this: IExecuteFunctions,
	group: SonosGroup,
	fadeSeconds: number,
): Promise<number | undefined> {
	if (fadeSeconds <= 0 || !isPlaying(group)) {
		await callSonosApi.call(this, 'POST', `groups/${group.id}/playback/pause`);
		return undefined;
	}

	const startVolume = await getGroupVolume.call(this, group.id);
	await rampVolume.call(this, group.id, startVolume, 0, fadeSeconds);
	await callSonosApi.call(this, 'POST', `groups/${group.id}/playback/pause`);
	await callSonosApi.call(this, 'POST', `groups/${group.id}/groupVolume`, { volume: startVolume });
	return startVolume;
}

/**
 * Loads new content (favorite or playlist) on a group.
 * With a transition duration, the current music fades out, the new content is loaded
 * at volume 0 and fades in up to the requested volume (or the previous one).
 */
async function loadContent(
	this: IExecuteFunctions,
	itemIndex: number,
	group: SonosGroup,
	path: string,
	body: IDataObject,
): Promise<number | undefined> {
	const transition = parseFadeDuration(this.getNodeParameter('transitionDuration', itemIndex, 0));
	if (transition <= 0) {
		const volume = await applyOptionalVolume.call(this, itemIndex, group.id);
		await callSonosApi.call(this, 'POST', path, body);
		return volume;
	}

	const requestedVolume = this.getNodeParameter('setVolume', itemIndex, false)
		? parseVolume(this.getNodeParameter('volume', itemIndex))
		: undefined;
	const currentVolume = await getGroupVolume.call(this, group.id);
	const targetVolume = requestedVolume ?? currentVolume;

	if (isPlaying(group)) {
		await rampVolume.call(this, group.id, currentVolume, 0, transition);
	} else if (currentVolume !== 0) {
		await callSonosApi.call(this, 'POST', `groups/${group.id}/groupVolume`, { volume: 0 });
	}
	await callSonosApi.call(this, 'POST', path, body);
	await rampVolume.call(this, group.id, 0, targetVolume, transition);
	return targetVolume;
}

export async function executeGroupAction(
	this: IExecuteFunctions,
	action: string,
	itemIndex: number,
): Promise<IDataObject> {
	const { topology, group } = await getGroupForItem.call(this, itemIndex);
	if (action === 'pause') {
		const fadeDuration = parseFadeDuration(this.getNodeParameter('fadeDuration', itemIndex, 0));
		const restoredVolume = await fadeOutAndPause.call(this, group, fadeDuration);
		return { ...describeGroup(topology, group), fadeDuration, restoredVolume };
	}
	const volume =
		action === 'play' ? await applyOptionalVolume.call(this, itemIndex, group.id) : undefined;
	await callSonosApi.call(this, 'POST', `groups/${group.id}/playback/${action}`);
	return { ...describeGroup(topology, group), volume };
}

export async function playFavorite(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const household = this.getNodeParameter('household', itemIndex) as string;
	const { topology, group } = await getGroupForItem.call(this, itemIndex);
	const favorites = await callSonosApi.call(this, 'GET', `households/${household}/favorites`);
	const favorite = resolveItemId(
		favorites.items || [],
		String(this.getNodeParameter('favorite', itemIndex)),
		'favorite',
	);
	const volume = await loadContent.call(this, itemIndex, group, `groups/${group.id}/favorites`, {
		action: 'replace',
		playOnCompletion: true,
		favoriteId: favorite.id,
		playModes: {
			shuffle: this.getNodeParameter('shuffle', itemIndex),
			repeat: this.getNodeParameter('repeat', itemIndex),
			crossfade: this.getNodeParameter('crossfade', itemIndex),
		},
	});
	return { ...describeGroup(topology, group), favorite: favorite.name, volume };
}

export async function playPlaylist(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const household = this.getNodeParameter('household', itemIndex) as string;
	const { topology, group } = await getGroupForItem.call(this, itemIndex);
	const playlists = await callSonosApi.call(this, 'GET', `households/${household}/playlists`);
	const playlist = resolveItemId(
		playlists.playlists || [],
		String(this.getNodeParameter('playlist', itemIndex)),
		'playlist',
	);
	const volume = await loadContent.call(this, itemIndex, group, `groups/${group.id}/playlists`, {
		action: 'replace',
		playOnCompletion: true,
		playlistId: playlist.id,
		playModes: {
			shuffle: this.getNodeParameter('shuffle', itemIndex),
			repeat: this.getNodeParameter('repeat', itemIndex),
			crossfade: this.getNodeParameter('crossfade', itemIndex),
		},
	});
	return { ...describeGroup(topology, group), playlist: playlist.name, volume };
}

export async function setGroupVolume(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const { topology, group } = await getGroupForItem.call(this, itemIndex);
	const volume = parseVolume(this.getNodeParameter('volume', itemIndex));
	const fadeDuration = parseFadeDuration(this.getNodeParameter('fadeDuration', itemIndex, 0));
	if (fadeDuration > 0) {
		const currentVolume = await getGroupVolume.call(this, group.id);
		await rampVolume.call(this, group.id, currentVolume, volume, fadeDuration);
	} else {
		await callSonosApi.call(this, 'POST', `groups/${group.id}/groupVolume`, { volume });
	}
	return { ...describeGroup(topology, group), volume, fadeDuration };
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
