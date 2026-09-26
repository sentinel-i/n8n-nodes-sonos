import { IExecuteFunctions } from 'n8n-core';

import {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
	NodePropertyTypes,
} from 'n8n-workflow';
import {
	executeGroupAction,
	groupAll,
	groupPlayers,
	loadFavorites,
	loadGroups,
	loadHomeTheaterPlayback,
	loadHouseholds,
	loadPlayers,
	loadPlaylists,
	playAudioClip,
	playFavorite,
	playPlaylist,
	setGroupVolume,
	setHomeTheaterOptions,
	setTVPowerState,
} from './GenericFunctions';

export class Sonos implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sonos',
		name: 'sonos',
		icon: 'file:Sonos.svg',
		group: ['output'],
		version: 1,
		description: 'Control your Sonos system.',
		defaults: {
			name: 'Sonos',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'sonosOAuth2Api',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Household',
				name: 'household',
				type: 'options' as NodePropertyTypes,
				options: [],
				default: '',
				required: true,
				typeOptions: {
					loadOptionsMethod: 'loadHouseholds',
				},
			},
			{
				displayName: 'Action',
				name: 'action',
				type: 'options' as NodePropertyTypes,
				options: [
					{
						name: 'Play Audio Clip',
						value: 'playAudioClip',
						description:
							'Plays an audio file from a URL on every player of the selected groups, then the music resumes',
					},
					{
						name: 'Play',
						value: 'play',
						description: 'Starts the music on the selected group',
					},
					{
						name: 'Play Favorite',
						value: 'playFavorite',
						description: 'Loads a Sonos favorite and plays it on the selected group',
					},
					{
						name: 'Play Playlist',
						value: 'playPlaylist',
						description: 'Loads a Sonos playlist and plays it on the selected group',
					},
					{
						name: 'Pause',
						value: 'pause',
						description: 'Stops the music on the selected group',
					},
					{
						name: 'Toggle Play/Pause',
						value: 'togglePlayPause',
						description: 'Toggles the music on the selected group',
					},
					{
						name: 'Skip Song',
						value: 'skipToNextTrack',
						description: 'Skips the song on the selected group',
					},
					{
						name: 'Previous Song',
						value: 'skipToPreviousTrack',
						description: 'Jumps to previous song on the selected group',
					},
					{
						name: 'Group Players',
						value: 'groupPlayers',
						description:
							'Makes sure the selected players form one group (adds and removes players if needed)',
					},
					{
						name: 'Group All Players',
						value: 'groupAll',
						description: 'Groups all players in your system',
					},
					{
						name: 'Set Group Volume',
						value: 'groupVolume',
						description: 'Sets the volume of the selected group',
					},
					{
						name: 'Set Home Theater Options',
						value: 'setHomeTheaterOptions',
						description: 'Sets the options of your home theater like night mode or enhance dialog',
					},
					{
						name: 'Start Home Theater Playback',
						value: 'loadHomeTheaterPlayback',
						description: 'Starts the home theater playback',
					},
					{
						name: 'Set TV Power State',
						value: 'setTVPowerState',
						description: 'Sets the TV power state',
					},
				],
				default: '',
				required: true,
			},
			{
				displayName: 'Group',
				name: 'target',
				type: 'options' as NodePropertyTypes,
				options: [],
				default: '',
				description:
					'Group to control. Empty: first group found. In an expression, use a player name, a group name or an ID.',
				displayOptions: {
					show: {
						action: [
							'play',
							'playFavorite',
							'playPlaylist',
							'pause',
							'togglePlayPause',
							'skipToNextTrack',
							'skipToPreviousTrack',
							'groupVolume',
						],
					},
				},
				typeOptions: {
					loadOptionsMethod: 'loadGroups',
					loadOptionsDependsOn: ['household'],
				},
			},
			{
				displayName: 'Groups',
				name: 'targets',
				type: 'multiOptions' as NodePropertyTypes,
				options: [],
				default: [],
				required: true,
				description:
					'The clip is played on every player of these groups. In an expression, use a comma-separated list of player or group names.',
				displayOptions: {
					show: {
						action: ['playAudioClip'],
					},
				},
				typeOptions: {
					loadOptionsMethod: 'loadGroups',
					loadOptionsDependsOn: ['household'],
				},
			},
			{
				displayName: 'Players',
				name: 'members',
				type: 'multiOptions' as NodePropertyTypes,
				options: [],
				default: [],
				required: true,
				description:
					'Players that must be in the group. In an expression, use a comma-separated list of player names.',
				displayOptions: {
					show: {
						action: ['groupPlayers'],
					},
				},
				typeOptions: {
					loadOptionsMethod: 'loadPlayers',
					loadOptionsDependsOn: ['household', 'action'],
				},
			},
			{
				displayName: 'Player',
				name: 'player',
				type: 'options' as NodePropertyTypes,
				options: [],
				default: '',
				required: true,
				displayOptions: {
					show: {
						action: ['setHomeTheaterOptions', 'loadHomeTheaterPlayback', 'setTVPowerState'],
					},
				},
				typeOptions: {
					loadOptionsMethod: 'loadPlayers',
					loadOptionsDependsOn: ['household', 'action'],
				},
			},
			{
				displayName: 'Favorite',
				name: 'favorite',
				type: 'options' as NodePropertyTypes,
				options: [],
				default: '',
				required: true,
				description: 'Sonos favorite to play. In an expression, use its name or its ID.',
				displayOptions: {
					show: {
						action: ['playFavorite'],
					},
				},
				typeOptions: {
					loadOptionsMethod: 'loadFavorites',
					loadOptionsDependsOn: ['household'],
				},
			},
			{
				displayName: 'Playlist',
				name: 'playlist',
				type: 'options' as NodePropertyTypes,
				options: [],
				default: '',
				required: true,
				description: 'Sonos playlist to play. In an expression, use its name or its ID.',
				displayOptions: {
					show: {
						action: ['playPlaylist'],
					},
				},
				typeOptions: {
					loadOptionsMethod: 'loadPlaylists',
					loadOptionsDependsOn: ['household'],
				},
			},
			{
				displayName: 'Shuffle',
				name: 'shuffle',
				type: 'boolean' as NodePropertyTypes,
				default: true,
				required: true,
				displayOptions: {
					show: {
						action: ['playFavorite', 'playPlaylist'],
					},
				},
			},
			{
				displayName: 'Repeat',
				name: 'repeat',
				type: 'boolean' as NodePropertyTypes,
				default: true,
				required: true,
				displayOptions: {
					show: {
						action: ['playFavorite', 'playPlaylist'],
					},
				},
			},
			{
				displayName: 'Crossfade',
				name: 'crossfade',
				type: 'boolean' as NodePropertyTypes,
				default: true,
				required: true,
				displayOptions: {
					show: {
						action: ['playFavorite', 'playPlaylist'],
					},
				},
			},
			{
				displayName: 'Fade Out Duration',
				name: 'fadeDuration',
				type: 'number' as NodePropertyTypes,
				default: 0,
				description:
					'Seconds during which the volume is lowered before pausing (0 = pause immediately). The original volume is restored once paused.',
				typeOptions: {
					minValue: 0,
					maxValue: 300,
					numberStepSize: 1,
				},
				displayOptions: {
					show: {
						action: ['pause'],
					},
				},
			},
			{
				displayName: 'Set Volume',
				name: 'setVolume',
				type: 'boolean' as NodePropertyTypes,
				default: false,
				description: 'Whether to set the group volume before starting the music',
				displayOptions: {
					show: {
						action: ['play', 'playFavorite', 'playPlaylist'],
					},
				},
			},
			{
				displayName: 'Volume',
				name: 'volume',
				type: 'number' as NodePropertyTypes,
				default: 20,
				required: true,
				typeOptions: {
					maxValue: 100,
					minValue: 0,
					numberStepSize: 1,
				},
				displayOptions: {
					show: {
						action: ['play', 'playFavorite', 'playPlaylist'],
						setVolume: [true],
					},
				},
			},
			{
				displayName: 'Volume',
				name: 'volume',
				type: 'number' as NodePropertyTypes,
				default: 50,
				required: true,
				typeOptions: {
					maxValue: 100,
					minValue: 1,
					numberStepSize: 1,
				},
				displayOptions: {
					show: {
						action: ['playAudioClip', 'groupVolume'],
					},
				},
			},
			{
				displayName: 'Soundfile',
				name: 'url',
				type: 'string' as NodePropertyTypes,
				default: 'http://www.moviesoundclips.net/effects/animals/wolf-howls.mp3',
				required: true,
				displayOptions: {
					show: {
						action: ['playAudioClip'],
					},
				},
			},
			{
				displayName: 'Night Mode',
				name: 'nightMode',
				type: 'boolean' as NodePropertyTypes,
				default: false,
				displayOptions: {
					show: {
						action: ['setHomeTheaterOptions'],
					},
				},
			},
			{
				displayName: 'Enhance Dialog',
				name: 'enhanceDialog',
				type: 'boolean' as NodePropertyTypes,
				default: false,
				displayOptions: {
					show: {
						action: ['setHomeTheaterOptions'],
					},
				},
			},
			{
				displayName: 'Power State',
				name: 'tvPowerState',
				type: 'boolean' as NodePropertyTypes,
				default: false,
				displayOptions: {
					show: {
						action: ['setTVPowerState'],
					},
				},
			},
		],
	};

	methods = {
		loadOptions: {
			loadHouseholds,
			loadFavorites,
			loadGroups,
			loadPlayers,
			loadPlaylists,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const credentials = await this.getCredentials('sonosOAuth2Api');
		if (credentials === undefined) {
			throw new NodeOperationError(this.getNode(), 'No credentials got returned!');
		}
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Each incoming item is one command, e.g. one row of a schedule table
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const action = this.getNodeParameter('action', itemIndex) as string;
			try {
				let details: IDataObject;
				switch (action) {
					case 'playAudioClip':
						details = await playAudioClip.call(this, itemIndex);
						break;
					case 'groupAll':
						details = await groupAll.call(this);
						break;
					case 'groupPlayers':
						details = await groupPlayers.call(this, itemIndex);
						break;
					case 'play':
					case 'pause':
					case 'togglePlayPause':
					case 'skipToNextTrack':
					case 'skipToPreviousTrack':
						details = await executeGroupAction.call(this, action, itemIndex);
						break;
					case 'playFavorite':
						details = await playFavorite.call(this, itemIndex);
						break;
					case 'playPlaylist':
						details = await playPlaylist.call(this, itemIndex);
						break;
					case 'groupVolume':
						details = await setGroupVolume.call(this, itemIndex);
						break;
					case 'setTVPowerState':
						details = await setTVPowerState.call(this, itemIndex);
						break;
					case 'loadHomeTheaterPlayback':
						details = await loadHomeTheaterPlayback.call(this, itemIndex);
						break;
					case 'setHomeTheaterOptions':
						details = await setHomeTheaterOptions.call(this, itemIndex);
						break;
					default:
						throw new NodeOperationError(this.getNode(), 'Unknown method or not implemented');
				}
				returnData.push({
					json: { message: 'ok', action, ...details },
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { action, error: error.message },
						pairedItem: { item: itemIndex },
					});
				} else {
					throw new NodeOperationError(this.getNode(), error, { itemIndex });
				}
			}
		}
		return [returnData];
	}
}
