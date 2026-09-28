import { createMock } from '@golevelup/ts-jest';
import { promisify } from 'util';
import {
	loadHouseholds,
	loadPlayers,
	getFirstGroup,
	loadFavorites,
	loadGroups,
	loadPlaylists,
	resolveGroup,
	getTopology,
	timing,
} from '../../nodes/Sonos/GenericFunctions';
import { readFile } from 'fs';
import { OptionsWithUrl, RequestPromiseOptions } from 'request-promise-native';
import { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-core';
import { ICredentialDataDecryptedObject, INodeParameters } from 'n8n-workflow';
import { INodeExecutionData, INodeType } from 'n8n-workflow/dist';
import { Sonos } from '../../nodes/Sonos/Sonos.node';
import { SonosOAuth2Api } from '../../credentials/SonosOAuth2Api.credentials';

const readFileAsync = promisify(readFile);

describe('Sonos Node', () => {
	let credentials: Map<string, ICredentialDataDecryptedObject>;
	let nodeParameters: INodeParameters = {};
	let inputItems: INodeExecutionData[] = [];
	let optionsStub: ILoadOptionsFunctions;
	let executeStub: IExecuteFunctions;
	let node: Sonos;
	beforeEach(() => {
		nodeParameters = {};
		inputItems = [{ json: {} }];
		credentials = new Map<string, ICredentialDataDecryptedObject>();
		optionsStub = createMock<ILoadOptionsFunctions>({
			getCredentials: (type: string) => Promise.resolve(credentials.get(type) as any),
			getNodeParameter: (parameterName) => nodeParameters[parameterName],
		});
		// Parameters given as functions receive the item index, like expressions in n8n
		const getNodeParameter = (parameterName: string, itemIndex: number, fallbackValue?: any) => {
			const value = nodeParameters[parameterName] as any;
			if (typeof value === 'function') {
				return value(itemIndex);
			}
			return value === undefined ? fallbackValue : value;
		};
		executeStub = createMock<IExecuteFunctions>({
			getCredentials: (type: string) => Promise.resolve(credentials.get(type) as any),
		} as any);
		executeStub.getNodeParameter = getNodeParameter as any;
		executeStub.getInputData = () => inputItems;
		executeStub.continueOnFail = () => false;
		executeStub.helpers.returnJsonArray = (jsonData) => {
			return [{ json: jsonData }] as INodeExecutionData[];
		};
		credentials.set('sonosOAuth2Api', {});
		node = new Sonos();

		new SonosOAuth2Api();
	});
	describe('Configuration', () => {
		it('Fetches households', async () => {
			optionsStub.helpers.requestOAuth2 = jest
				.fn()
				.mockImplementation(() => readFileAsync('./test/Sonos/households.response.json', 'utf-8'));
			const result = await loadHouseholds.call(optionsStub);

			expect(result.length).toEqual(1);
			expect(result[0].name).toEqual('Sonos_MyHouseholdId');
			expect(result[0].value).toEqual('Sonos_MyHouseholdId');
		});
		it('Fetches players', async () => {
			optionsStub.helpers.requestOAuth2 = jest
				.fn()
				.mockImplementation(() => readFileAsync('./test/Sonos/groups.response.json', 'utf-8'));
			const result = await loadPlayers.call(optionsStub);

			expect(result.length).toEqual(4);
			expect(result[0].name).toEqual('Sonos Roam');
			expect(result[0].value).toEqual('RINCON_123456');
			expect(result[1].name).toEqual('Sonos Move');
			expect(result[1].value).toEqual('RINCON_1234567');
			expect(result[2].name).toEqual('Hometheater Beam');
			expect(result[2].value).toEqual('RINCON_1234568');
			expect(result[3].name).toEqual('Hometheater Arc');
			expect(result[3].value).toEqual('RINCON_1234569');
		});
		it('Fetches players based on action and capabilities', async () => {
			optionsStub.helpers.requestOAuth2 = jest
				.fn()
				.mockImplementation(() => readFileAsync('./test/Sonos/groups.response.json', 'utf-8'));
			nodeParameters.action = 'loadHomeTheaterPlayback';
			const result = await loadPlayers.call(optionsStub);

			expect(result.length).toEqual(2);
			expect(result[0].name).toEqual('Hometheater Beam');
			expect(result[0].value).toEqual('RINCON_1234568');
			expect(result[1].name).toEqual('Hometheater Arc');
			expect(result[1].value).toEqual('RINCON_1234569');
		});
		it('Fetches players based on action and capabilities', async () => {
			optionsStub.helpers.requestOAuth2 = jest
				.fn()
				.mockImplementation(() => readFileAsync('./test/Sonos/groups.response.json', 'utf-8'));
			nodeParameters.action = 'setTVPowerState';
			const result = await loadPlayers.call(optionsStub);

			expect(result.length).toEqual(1);
			expect(result[0].name).toEqual('Hometheater Arc');
			expect(result[0].value).toEqual('RINCON_1234569');
		});
		it('Fetches the first group', async () => {
			optionsStub.helpers.requestOAuth2 = jest
				.fn()
				.mockImplementation(() => readFileAsync('./test/Sonos/groups.response.json', 'utf-8'));
			const result = await getFirstGroup.call(optionsStub);

			expect(result).toEqual('RINCON_1234567:1234');
		});
		it('Fetches Sonos Favorites', async () => {
			optionsStub.helpers.requestOAuth2 = jest
				.fn()
				.mockImplementation(() => readFileAsync('./test/Sonos/favorites.response.json', 'utf-8'));
			const result = await loadFavorites.call(optionsStub);

			expect(result.length).toEqual(2);
			expect(result[0].name).toEqual(
				'"Kill Your Darlings" // [DJ-Mix] By Dennis Kruissen - 10/2013',
			);
			expect(result[0].value).toEqual('10');
			expect(result[1].name).toEqual('10Hz Bass Test');
			expect(result[1].value).toEqual('41');
		});
	});

	describe('Action', () => {
		it('Plays an Audio Clip', async () => {
			nodeParameters['action'] = 'playAudioClip';
			let callOptions: OptionsWithUrl | any = {};
			nodeParameters['player'] = 'PLAYER_1';
			nodeParameters['url'] = 'https://url';
			nodeParameters['volume'] = 50;
			executeStub.helpers.requestOAuth2 = jest.fn().mockImplementation((...args: any[]) => {
				callOptions = args[1];
				return readFileAsync('./test/Sonos/playAudioClip.response.json', 'utf-8');
			});
			const result = await node.execute.apply(executeStub);
			const executionResponse = result[0][0] as any;
			expect(executionResponse?.json.message).toEqual('ok');

			const responseBody = JSON.parse(callOptions.body);
			expect(responseBody.streamUrl).toEqual('https://url');
			expect(responseBody.volume).toEqual(50);
			expect(callOptions.uri).toEqual(
				'https://api.ws.sonos.com/control/api/v1/players/PLAYER_1/audioClip',
			);
		});

		it('Groups all Players', async () => {
			nodeParameters['action'] = 'groupAll';
			let callOptions: OptionsWithUrl | any = {};
			nodeParameters['household'] = 'HOUSEHOLD_1';
			executeStub.helpers.requestOAuth2 = jest.fn().mockImplementation((...args: any[]) => {
				callOptions = args[1];
				if (callOptions.uri.endsWith('/groups')) {
					return readFileAsync('./test/Sonos/groups.response.json', 'utf-8');
				} else {
					return '{}';
				}
			});
			const result = await node.execute.apply(executeStub);
			const executionResponse = result[0][0] as any;
			expect(executionResponse?.json.message).toEqual('ok');

			const responseBody = JSON.parse(callOptions.body);
			expect(responseBody.playerIds.length).toEqual(4);
			expect(callOptions.uri).toEqual(
				'https://api.ws.sonos.com/control/api/v1/households/HOUSEHOLD_1/groups/createGroup',
			);
		});

		it('Executes Group Action on First Group', async () => {
			nodeParameters['action'] = 'play';
			let callOptions: OptionsWithUrl | any = {};
			nodeParameters['household'] = 'HOUSEHOLD_1';
			executeStub.helpers.requestOAuth2 = jest.fn().mockImplementation((...args: any[]) => {
				callOptions = args[1];
				if (callOptions.uri.endsWith('/groups')) {
					return readFileAsync('./test/Sonos/groups.response.json', 'utf-8');
				} else {
					return '{}';
				}
			});

			const result = await node.execute.apply(executeStub);
			const executionResponse = result[0][0] as any;
			expect(executionResponse?.json.message).toEqual('ok');

			expect(callOptions.body).toEqual(undefined);
			expect(callOptions.uri).toEqual(
				'https://api.ws.sonos.com/control/api/v1/groups/RINCON_1234567:1234/playback/play',
			);
		});

		it('Sets Group Volume', async () => {
			nodeParameters['action'] = 'groupVolume';
			nodeParameters['volume'] = 50;
			let callOptions: OptionsWithUrl | any = {};
			nodeParameters['household'] = 'HOUSEHOLD_1';
			executeStub.helpers.requestOAuth2 = jest.fn().mockImplementation((...args: any[]) => {
				callOptions = args[1];
				if (callOptions.uri.endsWith('/groups')) {
					return readFileAsync('./test/Sonos/groups.response.json', 'utf-8');
				} else {
					return '{}';
				}
			});

			const result = await node.execute.apply(executeStub);
			const executionResponse = result[0][0] as any;
			expect(executionResponse?.json.message).toEqual('ok');

			expect(callOptions.body).toEqual(JSON.stringify({ volume: 50 }));
			expect(callOptions.uri).toEqual(
				'https://api.ws.sonos.com/control/api/v1/groups/RINCON_1234567:1234/groupVolume',
			);
		});

		it('Plays Sonos Favorite on First Group', async () => {
			nodeParameters['action'] = 'playFavorite';
			let callOptions: OptionsWithUrl | any = {};
			nodeParameters['household'] = 'HOUSEHOLD_1';
			nodeParameters['favorite'] = '10';
			nodeParameters['shuffle'] = true;
			nodeParameters['repeat'] = true;
			nodeParameters['crossfade'] = true;
			executeStub.helpers.requestOAuth2 = jest.fn().mockImplementation((...args: any[]) => {
				callOptions = args[1];
				if (callOptions.uri.endsWith('/groups')) {
					return readFileAsync('./test/Sonos/groups.response.json', 'utf-8');
				} else if (callOptions.uri.endsWith('/favorites') && callOptions.method === 'GET') {
					return readFileAsync('./test/Sonos/favorites.response.json', 'utf-8');
				} else {
					return '{}';
				}
			});

			const result = await node.execute.apply(executeStub);
			const executionResponse = result[0][0] as any;
			expect(executionResponse?.json.message).toEqual('ok');

			const responseBody = JSON.parse(callOptions.body);
			expect(responseBody.favoriteId).toEqual('10');
			expect(responseBody.playModes.shuffle).toEqual(true);
			expect(responseBody.playModes.repeat).toEqual(true);
			expect(responseBody.playModes.crossfade).toEqual(true);
			expect(callOptions.uri).toEqual(
				'https://api.ws.sonos.com/control/api/v1/groups/RINCON_1234567:1234/favorites',
			);
		});

		it('Sets Home Theater Options', async () => {
			nodeParameters['action'] = 'setHomeTheaterOptions';
			nodeParameters['household'] = 'HOUSEHOLD_1';
			nodeParameters['player'] = '1';
			nodeParameters['nightMode'] = true;
			nodeParameters['enhanceDialog'] = true;
			executeStub.helpers.requestOAuth2 = jest.fn().mockImplementation((...args: any[]) =>
				Promise.resolve(
					JSON.stringify({
						nightMode: false,
						enhanceDialog: false,
						groupingLatency: 75,
					}),
				),
			);

			const result = await node.execute.apply(executeStub);
			const executionResponse = result[0][0] as any;
			expect(executionResponse?.json.message).toEqual('ok');
		});

		it('Loads Home Theater Playback', async () => {
			nodeParameters['action'] = 'loadHomeTheaterPlayback';
			nodeParameters['household'] = 'HOUSEHOLD_1';
			nodeParameters['player'] = '1';
			executeStub.helpers.requestOAuth2 = jest
				.fn()
				.mockImplementation((...args: any[]) => Promise.resolve(''));

			const result = await node.execute.apply(executeStub);
			const executionResponse = result[0][0] as any;
			expect(executionResponse?.json.message).toEqual('ok');
		});

		it('Sets TV Power State', async () => {
			nodeParameters['action'] = 'setTVPowerState';
			nodeParameters['household'] = 'HOUSEHOLD_1';
			nodeParameters['player'] = '1';
			executeStub.helpers.requestOAuth2 = jest
				.fn()
				.mockImplementation((...args: any[]) => Promise.resolve('{}'));

			const result = await node.execute.apply(executeStub);
			const executionResponse = result[0][0] as any;
			expect(executionResponse?.json.message).toEqual('ok');
		});
	});
	describe('Targets by group', () => {
		type Call = { method: string; uri: string; body?: any };
		let calls: Call[];
		let groupsFixture: string;

		beforeEach(async () => {
			calls = [];
			groupsFixture = './test/Sonos/multiGroups.response.json';
			nodeParameters['household'] = 'HOUSEHOLD_1';
			const fakeSonos = (...args: any[]) => {
				const options = args[1];
				calls.push({
					method: options.method,
					uri: options.uri,
					body: options.body ? JSON.parse(options.body) : undefined,
				});
				if (options.method === 'GET' && options.uri.endsWith('/groups')) {
					return readFileAsync(groupsFixture, 'utf-8');
				}
				if (options.method === 'GET' && options.uri.endsWith('/favorites')) {
					return readFileAsync('./test/Sonos/favorites.response.json', 'utf-8');
				}
				if (options.method === 'GET' && options.uri.endsWith('/groupVolume')) {
					return Promise.resolve(JSON.stringify({ volume: 30, muted: false, fixed: false }));
				}
				if (options.method === 'GET' && options.uri.endsWith('/playlists')) {
					return readFileAsync('./test/Sonos/playlists.response.json', 'utf-8');
				}
				return Promise.resolve('{}');
			};
			executeStub.helpers.requestOAuth2 = jest.fn().mockImplementation(fakeSonos);
			optionsStub.helpers.requestOAuth2 = jest.fn().mockImplementation(fakeSonos);
		});

		const commands = () => calls.filter((call) => call.method === 'POST');
		const api = (path: string) => 'https://api.ws.sonos.com/control/api/v1/' + path;

		it('Lists groups with their coordinator as value', async () => {
			const result = await loadGroups.call(optionsStub);

			expect(result.map((option) => option.name)).toEqual([
				'Kitchen',
				'Living Room + 1',
				'Office',
			]);
			expect(result[1].value).toEqual('RINCON_LIVING');
			expect(result[1].description).toEqual('Living Room, Dining Room');
		});

		it('Lists Sonos playlists', async () => {
			const result = await loadPlaylists.call(optionsStub);

			expect(result).toEqual([
				{ name: 'Morning Mix', value: '0' },
				{ name: 'Evening Mix', value: '1' },
			]);
		});

		it('Resolves a group from a player id, a player name or a group name', async () => {
			const topology = await getTopology.call(executeStub, 'HOUSEHOLD_1');

			expect(resolveGroup(topology, 'RINCON_LIVING').id).toEqual('RINCON_LIVING:20');
			expect(resolveGroup(topology, 'RINCON_DINING').id).toEqual('RINCON_LIVING:20');
			expect(resolveGroup(topology, 'dining room').id).toEqual('RINCON_LIVING:20');
			expect(resolveGroup(topology, 'Living Room + 1').id).toEqual('RINCON_LIVING:20');
			expect(resolveGroup(topology, 'Office').id).toEqual('RINCON_OFFICE:30');
			expect(resolveGroup(topology, '').id).toEqual('RINCON_KITCHEN:10');
			expect(() => resolveGroup(topology, 'Vestiaire')).toThrow('Vestiaire');
		});

		it('Pauses the selected group', async () => {
			nodeParameters['action'] = 'pause';
			nodeParameters['target'] = 'RINCON_OFFICE';

			const result = await node.execute.apply(executeStub);

			expect(commands()).toEqual([
				{ method: 'POST', uri: api('groups/RINCON_OFFICE:30/playback/pause'), body: undefined },
			]);
			expect(result[0][0].json).toMatchObject({
				message: 'ok',
				action: 'pause',
				groupName: 'Office',
				members: ['Office'],
			});
		});

		it('Fades out, pauses, then restores the volume', async () => {
			const sleep = jest.spyOn(timing, 'sleep').mockResolvedValue();
			nodeParameters['action'] = 'pause';
			nodeParameters['target'] = 'Kitchen';
			nodeParameters['fadeDuration'] = 6;

			const result = await node.execute.apply(executeStub);

			expect(sleep).toHaveBeenCalledTimes(3);
			expect(sleep).toHaveBeenCalledWith(2000);
			expect(commands()).toEqual([
				{ method: 'POST', uri: api('groups/RINCON_KITCHEN:10/groupVolume'), body: { volume: 20 } },
				{ method: 'POST', uri: api('groups/RINCON_KITCHEN:10/groupVolume'), body: { volume: 10 } },
				{ method: 'POST', uri: api('groups/RINCON_KITCHEN:10/groupVolume'), body: { volume: 0 } },
				{ method: 'POST', uri: api('groups/RINCON_KITCHEN:10/playback/pause'), body: undefined },
				{ method: 'POST', uri: api('groups/RINCON_KITCHEN:10/groupVolume'), body: { volume: 30 } },
			]);
			expect(result[0][0].json).toMatchObject({ fadeDuration: 6, restoredVolume: 30 });
			sleep.mockRestore();
		});

		it('Pauses without fading when the group is not playing', async () => {
			const sleep = jest.spyOn(timing, 'sleep').mockResolvedValue();
			nodeParameters['action'] = 'pause';
			nodeParameters['target'] = 'Office';
			nodeParameters['fadeDuration'] = 30;

			await node.execute.apply(executeStub);

			expect(sleep).not.toHaveBeenCalled();
			expect(commands()).toEqual([
				{ method: 'POST', uri: api('groups/RINCON_OFFICE:30/playback/pause'), body: undefined },
			]);
			sleep.mockRestore();
		});

		it('Rejects an invalid fade duration', async () => {
			nodeParameters['action'] = 'pause';
			nodeParameters['target'] = 'Kitchen';
			nodeParameters['fadeDuration'] = 900;

			await expect(node.execute.apply(executeStub)).rejects.toThrow('Invalid fade duration');
			expect(commands()).toEqual([]);
		});

		it('Switches favorites with a fade out / fade in transition', async () => {
			const sleep = jest.spyOn(timing, 'sleep').mockResolvedValue();
			nodeParameters['action'] = 'playFavorite';
			nodeParameters['target'] = 'Kitchen';
			nodeParameters['favorite'] = '41';
			nodeParameters['transitionDuration'] = 4;
			nodeParameters['setVolume'] = true;
			nodeParameters['volume'] = 20;

			const result = await node.execute.apply(executeStub);

			expect(sleep).toHaveBeenCalledTimes(4);
			expect(commands().map((call) => [call.uri, call.body?.volume ?? call.body?.favoriteId])).toEqual([
				[api('groups/RINCON_KITCHEN:10/groupVolume'), 15],
				[api('groups/RINCON_KITCHEN:10/groupVolume'), 0],
				[api('groups/RINCON_KITCHEN:10/favorites'), '41'],
				[api('groups/RINCON_KITCHEN:10/groupVolume'), 10],
				[api('groups/RINCON_KITCHEN:10/groupVolume'), 20],
			]);
			expect(result[0][0].json).toMatchObject({ favorite: '10Hz Bass Test', volume: 20 });
			sleep.mockRestore();
		});

		it('Starts silent then fades in when the group was not playing', async () => {
			const sleep = jest.spyOn(timing, 'sleep').mockResolvedValue();
			nodeParameters['action'] = 'playPlaylist';
			nodeParameters['target'] = 'Office';
			nodeParameters['playlist'] = 'Morning Mix';
			nodeParameters['transitionDuration'] = 4;
			nodeParameters['setVolume'] = true;
			nodeParameters['volume'] = 20;

			await node.execute.apply(executeStub);

			expect(commands().map((call) => [call.uri, call.body?.volume ?? call.body?.playlistId])).toEqual([
				[api('groups/RINCON_OFFICE:30/groupVolume'), 0],
				[api('groups/RINCON_OFFICE:30/playlists'), '0'],
				[api('groups/RINCON_OFFICE:30/groupVolume'), 10],
				[api('groups/RINCON_OFFICE:30/groupVolume'), 20],
			]);
			sleep.mockRestore();
		});

		it('Fades back to the current volume when no volume is set', async () => {
			const sleep = jest.spyOn(timing, 'sleep').mockResolvedValue();
			nodeParameters['action'] = 'playFavorite';
			nodeParameters['target'] = 'Kitchen';
			nodeParameters['favorite'] = '10';
			nodeParameters['transitionDuration'] = 2;

			const result = await node.execute.apply(executeStub);

			expect(commands().map((call) => [call.uri, call.body?.volume ?? call.body?.favoriteId])).toEqual([
				[api('groups/RINCON_KITCHEN:10/groupVolume'), 0],
				[api('groups/RINCON_KITCHEN:10/favorites'), '10'],
				[api('groups/RINCON_KITCHEN:10/groupVolume'), 30],
			]);
			expect(result[0][0].json.volume).toEqual(30);
			sleep.mockRestore();
		});

		it('Changes the group volume progressively', async () => {
			const sleep = jest.spyOn(timing, 'sleep').mockResolvedValue();
			nodeParameters['action'] = 'groupVolume';
			nodeParameters['target'] = 'Office';
			nodeParameters['volume'] = 0;
			nodeParameters['fadeDuration'] = 6;

			await node.execute.apply(executeStub);

			expect(sleep).toHaveBeenCalledWith(2000);
			expect(commands()).toEqual([
				{ method: 'POST', uri: api('groups/RINCON_OFFICE:30/groupVolume'), body: { volume: 20 } },
				{ method: 'POST', uri: api('groups/RINCON_OFFICE:30/groupVolume'), body: { volume: 10 } },
				{ method: 'POST', uri: api('groups/RINCON_OFFICE:30/groupVolume'), body: { volume: 0 } },
			]);
			sleep.mockRestore();
		});

		it('Sets the volume before playing a favorite chosen by name', async () => {
			nodeParameters['action'] = 'playFavorite';
			nodeParameters['target'] = 'Living Room';
			nodeParameters['favorite'] = '10hz bass test';
			nodeParameters['setVolume'] = true;
			nodeParameters['volume'] = '32';
			nodeParameters['shuffle'] = true;
			nodeParameters['repeat'] = true;
			nodeParameters['crossfade'] = false;

			const result = await node.execute.apply(executeStub);

			expect(commands().map((call) => call.uri)).toEqual([
				api('groups/RINCON_LIVING:20/groupVolume'),
				api('groups/RINCON_LIVING:20/favorites'),
			]);
			expect(commands()[0].body).toEqual({ volume: 32 });
			expect(commands()[1].body.favoriteId).toEqual('41');
			expect(result[0][0].json).toMatchObject({
				groupName: 'Living Room + 1',
				members: ['Living Room', 'Dining Room'],
				favorite: '10Hz Bass Test',
				volume: 32,
			});
		});

		it('Plays a favorite without touching the volume when not asked', async () => {
			nodeParameters['action'] = 'playFavorite';
			nodeParameters['target'] = 'RINCON_KITCHEN';
			nodeParameters['favorite'] = '10';

			await node.execute.apply(executeStub);

			expect(commands().map((call) => call.uri)).toEqual([
				api('groups/RINCON_KITCHEN:10/favorites'),
			]);
		});

		it('Plays a Sonos playlist chosen by name', async () => {
			nodeParameters['action'] = 'playPlaylist';
			nodeParameters['target'] = 'Office';
			nodeParameters['playlist'] = 'Evening Mix';
			nodeParameters['setVolume'] = true;
			nodeParameters['volume'] = 32;

			await node.execute.apply(executeStub);

			expect(commands().map((call) => call.uri)).toEqual([
				api('groups/RINCON_OFFICE:30/groupVolume'),
				api('groups/RINCON_OFFICE:30/playlists'),
			]);
			expect(commands()[1].body).toMatchObject({ playlistId: '1', playOnCompletion: true });
		});

		it('Starts the music with a volume', async () => {
			nodeParameters['action'] = 'play';
			nodeParameters['target'] = 'RINCON_KITCHEN';
			nodeParameters['setVolume'] = true;
			nodeParameters['volume'] = 14;

			await node.execute.apply(executeStub);

			expect(commands().map((call) => call.uri)).toEqual([
				api('groups/RINCON_KITCHEN:10/groupVolume'),
				api('groups/RINCON_KITCHEN:10/playback/play'),
			]);
		});

		it('Rejects an invalid volume', async () => {
			nodeParameters['action'] = 'groupVolume';
			nodeParameters['target'] = 'Office';
			nodeParameters['volume'] = 'fort';

			await expect(node.execute.apply(executeStub)).rejects.toThrow('Invalid volume');
			expect(commands()).toEqual([]);
		});

		it('Plays an audio clip on every player of the selected groups', async () => {
			nodeParameters['action'] = 'playAudioClip';
			nodeParameters['targets'] = ['RINCON_KITCHEN', 'RINCON_LIVING', 'RINCON_OFFICE'];
			nodeParameters['url'] = 'https://n8n.example.com/webhook/doorbell.mp3';
			nodeParameters['volume'] = 50;

			const result = await node.execute.apply(executeStub);

			expect(commands().map((call) => call.uri)).toEqual([
				api('players/RINCON_KITCHEN/audioClip'),
				api('players/RINCON_LIVING/audioClip'),
				api('players/RINCON_DINING/audioClip'),
				api('players/RINCON_OFFICE/audioClip'),
			]);
			expect(commands()[0].body).toMatchObject({
				streamUrl: 'https://n8n.example.com/webhook/doorbell.mp3',
				volume: 50,
			});
			expect(result[0][0].json.players).toEqual([
				'Kitchen',
				'Living Room',
				'Dining Room',
				'Office',
			]);
		});

		it('Accepts a comma separated list of names for the audio clip', async () => {
			nodeParameters['action'] = 'playAudioClip';
			nodeParameters['targets'] = 'Dining Room, Living Room';
			nodeParameters['url'] = 'https://n8n.example.com/clip.mp3';
			nodeParameters['volume'] = 50;

			await node.execute.apply(executeStub);

			expect(commands().map((call) => call.uri)).toEqual([
				api('players/RINCON_LIVING/audioClip'),
				api('players/RINCON_DINING/audioClip'),
			]);
		});

		it('Does nothing when the players are already grouped', async () => {
			nodeParameters['action'] = 'groupPlayers';
			nodeParameters['members'] = ['RINCON_DINING', 'RINCON_LIVING'];

			const result = await node.execute.apply(executeStub);

			expect(commands()).toEqual([]);
			expect(result[0][0].json).toMatchObject({ changed: false, groupName: 'Living Room + 1' });
		});

		it('Regroups the players when the group is not right', async () => {
			nodeParameters['action'] = 'groupPlayers';
			nodeParameters['members'] = 'Living Room, Dining Room, Office';

			const result = await node.execute.apply(executeStub);

			expect(commands()).toEqual([
				{
					method: 'POST',
					uri: api('households/HOUSEHOLD_1/groups/createGroup'),
					body: {
						playerIds: ['RINCON_LIVING', 'RINCON_DINING', 'RINCON_OFFICE'],
						musicContextGroupId: 'RINCON_LIVING:20',
					},
				},
			]);
			expect(result[0][0].json).toMatchObject({ changed: true });
		});

		it('Processes every incoming item', async () => {
			const rows = [
				{ room: 'Kitchen', volume: 14 },
				{ room: 'Living Room', volume: 20 },
				{ room: 'Office', volume: 20 },
			];
			inputItems = rows.map((row) => ({ json: row }));
			nodeParameters['action'] = 'groupVolume';
			nodeParameters['target'] = ((i: number) => rows[i].room) as any;
			nodeParameters['volume'] = ((i: number) => rows[i].volume) as any;

			const result = await node.execute.apply(executeStub);

			expect(result[0].length).toEqual(3);
			expect(commands()).toEqual([
				{ method: 'POST', uri: api('groups/RINCON_KITCHEN:10/groupVolume'), body: { volume: 14 } },
				{ method: 'POST', uri: api('groups/RINCON_LIVING:20/groupVolume'), body: { volume: 20 } },
				{ method: 'POST', uri: api('groups/RINCON_OFFICE:30/groupVolume'), body: { volume: 20 } },
			]);
			expect(result[0].map((item) => item.pairedItem)).toEqual([
				{ item: 0 },
				{ item: 1 },
				{ item: 2 },
			]);
		});
	});
});
