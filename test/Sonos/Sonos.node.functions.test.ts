import { createMock } from '@golevelup/ts-jest';
import { promisify } from 'util';
import {
	loadHouseholds,
	loadPlayers,
	getFirstGroup,
	loadFavorites,
	loadPlaylists,
	loadPlayerNames,
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
			expect(result[0].value).toEqual(
				'"Kill Your Darlings" // [DJ-Mix] By Dennis Kruissen - 10/2013',
			);
			expect(result[1].name).toEqual('10Hz Bass Test');
			expect(result[1].value).toEqual('10Hz Bass Test');
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

			// The volume is set on each player of the first group (last one checked here)
			expect(callOptions.body).toEqual(JSON.stringify({ volume: 50 }));
			expect(callOptions.uri).toEqual(
				'https://api.ws.sonos.com/control/api/v1/players/RINCON_1234567_1/playerVolume',
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
	describe('Players and volumes', () => {
		type Call = { method: string; uri: string; body?: any };
		let calls: Call[];
		let sleep: jest.SpyInstance;
		const playerVolumes: Record<string, number> = {
			RINCON_KITCHEN: 30,
			RINCON_LIVING: 30,
			RINCON_DINING: 20,
			RINCON_OFFICE: 30,
		};

		beforeEach(async () => {
			calls = [];
			nodeParameters['household'] = 'HOUSEHOLD_1';
			sleep = jest.spyOn(timing, 'sleep').mockResolvedValue();
			const fakeSonos = (...args: any[]) => {
				const options = args[1];
				const body = options.body ? JSON.parse(options.body) : undefined;
				calls.push({ method: options.method, uri: options.uri, body });
				if (options.method === 'GET' && options.uri.endsWith('/groups')) {
					return readFileAsync('./test/Sonos/multiGroups.response.json', 'utf-8');
				}
				if (options.method === 'GET' && options.uri.endsWith('/favorites')) {
					return readFileAsync('./test/Sonos/favorites.response.json', 'utf-8');
				}
				if (options.method === 'GET' && options.uri.endsWith('/playlists')) {
					return readFileAsync('./test/Sonos/playlists.response.json', 'utf-8');
				}
				if (options.method === 'GET' && options.uri.endsWith('/playerVolume')) {
					const playerId = options.uri.split('/players/')[1].split('/')[0];
					return Promise.resolve(JSON.stringify({ volume: playerVolumes[playerId] }));
				}
				if (options.uri.endsWith('/createGroup')) {
					return Promise.resolve(
						JSON.stringify({
							group: {
								id: 'NEW_GROUP:99',
								name: 'New group',
								coordinatorId: body.playerIds[0],
								playerIds: body.playerIds,
							},
						}),
					);
				}
				return Promise.resolve('{}');
			};
			executeStub.helpers.requestOAuth2 = jest.fn().mockImplementation(fakeSonos);
			optionsStub.helpers.requestOAuth2 = jest.fn().mockImplementation(fakeSonos);
		});

		afterEach(() => sleep.mockRestore());

		const commands = () => calls.filter((call) => call.method === 'POST');
		const api = (path: string) => 'https://api.ws.sonos.com/control/api/v1/' + path;
		const volumeCalls = () =>
			commands()
				.filter((call) => call.uri.endsWith('/playerVolume'))
				.map((call) => [call.uri.split('/players/')[1].split('/')[0], call.body.volume]);

		describe('Configuration', () => {
			it('Lists players by name', async () => {
				nodeParameters['action'] = 'pause';
				const result = await loadPlayerNames.call(optionsStub);

				expect(result).toEqual([
					{ name: 'Kitchen', value: 'Kitchen' },
					{ name: 'Living Room', value: 'Living Room' },
					{ name: 'Dining Room', value: 'Dining Room' },
					{ name: 'Office', value: 'Office' },
				]);
			});

			it('Lists Sonos playlists', async () => {
				const result = await loadPlaylists.call(optionsStub);

				expect(result).toEqual([
					{ name: 'Morning Mix', value: 'Morning Mix' },
					{ name: 'Evening Mix', value: 'Evening Mix' },
				]);
			});

			it('Resolves a group from a player id, a player name or a group name', async () => {
				const topology = await getTopology.call(executeStub, 'HOUSEHOLD_1');

				expect(resolveGroup(topology, 'RINCON_LIVING').id).toEqual('RINCON_LIVING:20');
				expect(resolveGroup(topology, 'dining room').id).toEqual('RINCON_LIVING:20');
				expect(resolveGroup(topology, 'Living Room + 1').id).toEqual('RINCON_LIVING:20');
				expect(resolveGroup(topology, '').id).toEqual('RINCON_KITCHEN:10');
				expect(() => resolveGroup(topology, 'Garage')).toThrow('Garage');
			});
		});

		describe('Grouping', () => {
			it('Acts directly when the players already form their own group', async () => {
				nodeParameters['action'] = 'pause';
				nodeParameters['players'] = 'Office';

				const result = await node.execute.apply(executeStub);

				expect(commands()).toEqual([
					{ method: 'POST', uri: api('groups/RINCON_OFFICE:30/playback/pause'), body: undefined },
				]);
				expect(result[0][0].json).toMatchObject({
					groupName: 'Office',
					members: ['Office'],
					regrouped: false,
				});
			});

			it('Accepts the players in any order and case', async () => {
				nodeParameters['action'] = 'pause';
				nodeParameters['players'] = ['dining room', 'RINCON_LIVING'];

				await node.execute.apply(executeStub);

				expect(commands().map((call) => call.uri)).toEqual([
					api('groups/RINCON_LIVING:20/playback/pause'),
				]);
			});

			it('Takes a player out of a group it was added to by mistake', async () => {
				nodeParameters['action'] = 'pause';
				nodeParameters['players'] = 'Living Room';

				const result = await node.execute.apply(executeStub);

				expect(commands()).toEqual([
					{
						method: 'POST',
						uri: api('households/HOUSEHOLD_1/groups/createGroup'),
						body: { playerIds: ['RINCON_LIVING'], musicContextGroupId: 'RINCON_LIVING:20' },
					},
					{ method: 'POST', uri: api('groups/NEW_GROUP:99/playback/pause'), body: undefined },
				]);
				expect(result[0][0].json).toMatchObject({ members: ['Living Room'], regrouped: true });
			});

			it('Adds the missing players to the group', async () => {
				nodeParameters['action'] = 'groupVolume';
				nodeParameters['players'] = 'Living Room, Dining Room, Office';
				nodeParameters['volume'] = 25;

				const result = await node.execute.apply(executeStub);

				expect(commands()[0]).toEqual({
					method: 'POST',
					uri: api('households/HOUSEHOLD_1/groups/createGroup'),
					body: {
						playerIds: ['RINCON_LIVING', 'RINCON_DINING', 'RINCON_OFFICE'],
						musicContextGroupId: 'RINCON_LIVING:20',
					},
				});
				expect(result[0][0].json).toMatchObject({
					members: ['Living Room', 'Dining Room', 'Office'],
					regrouped: true,
				});
			});

			it('Groups without the current music when Sonos cannot copy it', async () => {
				nodeParameters['action'] = 'pause';
				nodeParameters['players'] = 'Living Room';
				const fakeSonos = (executeStub.helpers.requestOAuth2 as jest.Mock).getMockImplementation()!;
				executeStub.helpers.requestOAuth2 = jest.fn().mockImplementation((...args: any[]) => {
					const options = args[1];
					if (
						options.uri.endsWith('/createGroup') &&
						JSON.parse(options.body).musicContextGroupId
					) {
						calls.push({
							method: options.method,
							uri: options.uri,
							body: JSON.parse(options.body),
						});
						return Promise.reject(
							new Error('499 - ERROR_PLAYBACK_FAILED music context content cannot be copied'),
						);
					}
					return fakeSonos(...args);
				});

				const result = await node.execute.apply(executeStub);

				expect(commands().map((call) => [call.uri, call.body])).toEqual([
					[
						api('households/HOUSEHOLD_1/groups/createGroup'),
						{ playerIds: ['RINCON_LIVING'], musicContextGroupId: 'RINCON_LIVING:20' },
					],
					[api('households/HOUSEHOLD_1/groups/createGroup'), { playerIds: ['RINCON_LIVING'] }],
					[api('groups/NEW_GROUP:99/playback/pause'), undefined],
				]);
				expect(result[0][0].json).toMatchObject({ regrouped: true });
			});

			it('Regroups without copying the music before playing a favorite', async () => {
				nodeParameters['action'] = 'playFavorite';
				nodeParameters['players'] = 'Living Room';
				nodeParameters['favorite'] = '10';
				nodeParameters['fadeDuration'] = 2;

				await node.execute.apply(executeStub);

				expect(commands().map((call) => [call.uri, call.body])).toEqual([
					[api('households/HOUSEHOLD_1/groups/createGroup'), { playerIds: ['RINCON_LIVING'] }],
					[api('players/RINCON_LIVING/playerVolume'), { volume: 0 }],
					[
						api('groups/NEW_GROUP:99/favorites'),
						expect.objectContaining({ favoriteId: '10', playOnCompletion: true }),
					],
					[api('players/RINCON_LIVING/playerVolume'), { volume: 30 }],
				]);
			});

			it('Rejects an unknown player', async () => {
				nodeParameters['action'] = 'pause';
				nodeParameters['players'] = 'Office, Garage';

				await expect(node.execute.apply(executeStub)).rejects.toThrow(
					'No Sonos player found for "Garage"',
				);
				expect(commands()).toEqual([]);
			});

			it('Keeps the former Group field working, without regrouping', async () => {
				nodeParameters['action'] = 'pause';
				nodeParameters['target'] = 'RINCON_LIVING';

				await node.execute.apply(executeStub);

				expect(commands().map((call) => call.uri)).toEqual([
					api('groups/RINCON_LIVING:20/playback/pause'),
				]);
			});

			it('Keeps the former Group Players action working', async () => {
				nodeParameters['action'] = 'groupPlayers';
				nodeParameters['members'] = ['RINCON_DINING', 'RINCON_LIVING'];

				const result = await node.execute.apply(executeStub);

				expect(commands()).toEqual([]);
				expect(result[0][0].json).toMatchObject({ changed: false, groupName: 'Living Room + 1' });
			});
		});

		describe('Volumes', () => {
			it('Sets one volume per player', async () => {
				nodeParameters['action'] = 'groupVolume';
				nodeParameters['players'] = 'Living Room, Dining Room';
				nodeParameters['volume'] = '32, 18';

				const result = await node.execute.apply(executeStub);

				expect(volumeCalls()).toEqual([
					['RINCON_LIVING', 32],
					['RINCON_DINING', 18],
				]);
				expect(result[0][0].json.volume).toEqual([32, 18]);
			});

			it('Applies a single volume to every player', async () => {
				nodeParameters['action'] = 'groupVolume';
				nodeParameters['players'] = 'Living Room, Dining Room';
				nodeParameters['volume'] = 25;

				const result = await node.execute.apply(executeStub);

				expect(volumeCalls()).toEqual([
					['RINCON_LIVING', 25],
					['RINCON_DINING', 25],
				]);
				expect(result[0][0].json.volume).toEqual(25);
			});

			it('Rejects a volume list that does not match the players', async () => {
				nodeParameters['action'] = 'groupVolume';
				nodeParameters['players'] = 'Living Room, Dining Room';
				nodeParameters['volume'] = '30, 20, 10';

				await expect(node.execute.apply(executeStub)).rejects.toThrow('2 volumes');
				expect(volumeCalls()).toEqual([]);
			});

			it('Rejects an invalid volume', async () => {
				nodeParameters['action'] = 'groupVolume';
				nodeParameters['players'] = 'Office';
				nodeParameters['volume'] = 'fort';

				await expect(node.execute.apply(executeStub)).rejects.toThrow('Invalid volume');
				expect(commands()).toEqual([]);
			});

			it('Fades every player at the same time, each to its own volume', async () => {
				nodeParameters['action'] = 'groupVolume';
				nodeParameters['players'] = 'Living Room, Dining Room';
				nodeParameters['volume'] = 0;
				nodeParameters['fadeDuration'] = 4;

				await node.execute.apply(executeStub);

				expect(sleep).toHaveBeenCalledTimes(2);
				expect(volumeCalls()).toEqual([
					['RINCON_LIVING', 15],
					['RINCON_DINING', 10],
					['RINCON_LIVING', 0],
					['RINCON_DINING', 0],
				]);
			});
		});

		describe('Playback', () => {
			it('Sets the volumes before playing a favorite chosen by name', async () => {
				nodeParameters['action'] = 'playFavorite';
				nodeParameters['players'] = 'Living Room, Dining Room';
				nodeParameters['favorite'] = '10hz bass test';
				nodeParameters['setVolume'] = true;
				nodeParameters['volume'] = '32, 20';

				const result = await node.execute.apply(executeStub);

				expect(commands().map((call) => call.uri)).toEqual([
					api('players/RINCON_LIVING/playerVolume'),
					api('players/RINCON_DINING/playerVolume'),
					api('groups/RINCON_LIVING:20/favorites'),
				]);
				expect(commands()[2].body.favoriteId).toEqual('41');
				expect(result[0][0].json).toMatchObject({ favorite: '10Hz Bass Test', volume: [32, 20] });
			});

			it('Finds a favorite whatever the encoding, quotes or spacing of its name', async () => {
				const fakeSonos = (executeStub.helpers.requestOAuth2 as jest.Mock).getMockImplementation()!;
				executeStub.helpers.requestOAuth2 = jest.fn().mockImplementation((...args: any[]) => {
					const options = args[1];
					if (options.method === 'GET' && options.uri.endsWith('/favorites')) {
						return Promise.resolve(
							JSON.stringify({
								items: [
									{ id: '7', name: 'Radio Rock &amp; Roll' },
									{ id: '8', name: 'Today\u2019s  Hits' },
								],
							}),
						);
					}
					return fakeSonos(...args);
				});
				nodeParameters['action'] = 'playFavorite';
				nodeParameters['players'] = 'Kitchen';

				nodeParameters['favorite'] = 'Radio ROCK & Roll';
				await node.execute.apply(executeStub);
				nodeParameters['favorite'] = "today's hits";
				await node.execute.apply(executeStub);

				expect(commands().map((call) => call.body.favoriteId)).toEqual(['7', '8']);
			});

			it('Lists the available favorites when one is not found', async () => {
				nodeParameters['action'] = 'playFavorite';
				nodeParameters['players'] = 'Kitchen';
				nodeParameters['favorite'] = 'Unknown radio';

				await expect(node.execute.apply(executeStub)).rejects.toThrow(
					'No Sonos favorite found for "Unknown radio". Available: ""Kill Your Darlings" // [DJ-Mix] By Dennis Kruissen - 10/2013", "10Hz Bass Test"',
				);
			});

			it('Plays a favorite without touching the volume when not asked', async () => {
				nodeParameters['action'] = 'playFavorite';
				nodeParameters['players'] = 'Kitchen';
				nodeParameters['favorite'] = '10';

				await node.execute.apply(executeStub);

				expect(commands().map((call) => call.uri)).toEqual([
					api('groups/RINCON_KITCHEN:10/favorites'),
				]);
			});

			it('Plays a Sonos playlist chosen by name', async () => {
				nodeParameters['action'] = 'playPlaylist';
				nodeParameters['players'] = 'Office';
				nodeParameters['playlist'] = 'Evening Mix';
				nodeParameters['setVolume'] = true;
				nodeParameters['volume'] = 32;

				await node.execute.apply(executeStub);

				expect(commands().map((call) => call.uri)).toEqual([
					api('players/RINCON_OFFICE/playerVolume'),
					api('groups/RINCON_OFFICE:30/playlists'),
				]);
				expect(commands()[1].body).toMatchObject({ playlistId: '1', playOnCompletion: true });
			});

			it('Starts the music with a volume', async () => {
				nodeParameters['action'] = 'play';
				nodeParameters['players'] = 'Kitchen';
				nodeParameters['setVolume'] = true;
				nodeParameters['volume'] = 14;

				await node.execute.apply(executeStub);

				expect(commands().map((call) => call.uri)).toEqual([
					api('players/RINCON_KITCHEN/playerVolume'),
					api('groups/RINCON_KITCHEN:10/playback/play'),
				]);
			});

			it('Switches favorites with a fade out / fade in on every player', async () => {
				nodeParameters['action'] = 'playFavorite';
				nodeParameters['players'] = 'Living Room, Dining Room';
				nodeParameters['favorite'] = '41';
				nodeParameters['fadeDuration'] = 4;
				nodeParameters['setVolume'] = true;
				nodeParameters['volume'] = '40, 10';

				await node.execute.apply(executeStub);

				expect(sleep).toHaveBeenCalledTimes(4);
				expect(
					commands().map((call) =>
						call.uri.endsWith('/favorites') ? 'favorite' : call.body.volume,
					),
				).toEqual([15, 10, 0, 0, 'favorite', 20, 5, 40, 10]);
			});

			it('Starts silent then fades in when the players were not playing', async () => {
				nodeParameters['action'] = 'playPlaylist';
				nodeParameters['players'] = 'Office';
				nodeParameters['playlist'] = 'Morning Mix';
				nodeParameters['fadeDuration'] = 4;
				nodeParameters['setVolume'] = true;
				nodeParameters['volume'] = 20;

				await node.execute.apply(executeStub);

				expect(
					commands().map((call) => [call.uri, call.body?.volume ?? call.body?.playlistId]),
				).toEqual([
					[api('players/RINCON_OFFICE/playerVolume'), 0],
					[api('groups/RINCON_OFFICE:30/playlists'), '0'],
					[api('players/RINCON_OFFICE/playerVolume'), 10],
					[api('players/RINCON_OFFICE/playerVolume'), 20],
				]);
			});

			it('Fades back to the previous volumes when no volume is set', async () => {
				nodeParameters['action'] = 'playFavorite';
				nodeParameters['players'] = 'Kitchen';
				nodeParameters['favorite'] = '10';
				nodeParameters['fadeDuration'] = 2;

				const result = await node.execute.apply(executeStub);

				expect(
					commands().map((call) => [call.uri, call.body?.volume ?? call.body?.favoriteId]),
				).toEqual([
					[api('players/RINCON_KITCHEN/playerVolume'), 0],
					[api('groups/RINCON_KITCHEN:10/favorites'), '10'],
					[api('players/RINCON_KITCHEN/playerVolume'), 30],
				]);
				expect(result[0][0].json.volume).toEqual(30);
			});
		});

		describe('Pause', () => {
			it('Fades out every player, pauses, then gives each its volume back', async () => {
				nodeParameters['action'] = 'pause';
				nodeParameters['players'] = 'Living Room, Dining Room';
				nodeParameters['fadeDuration'] = 4;

				const result = await node.execute.apply(executeStub);

				expect(
					commands().map((call) => (call.uri.endsWith('/pause') ? 'pause' : call.body.volume)),
				).toEqual([15, 10, 0, 0, 'pause', 30, 20]);
				expect(result[0][0].json).toMatchObject({ fadeDuration: 4, restoredVolume: [30, 20] });
			});

			it('Pauses without fading when the players are not playing', async () => {
				nodeParameters['action'] = 'pause';
				nodeParameters['players'] = 'Office';
				nodeParameters['fadeDuration'] = 30;

				await node.execute.apply(executeStub);

				expect(sleep).not.toHaveBeenCalled();
				expect(commands().map((call) => call.uri)).toEqual([
					api('groups/RINCON_OFFICE:30/playback/pause'),
				]);
			});

			it('Rejects an invalid fade duration', async () => {
				nodeParameters['action'] = 'pause';
				nodeParameters['players'] = 'Kitchen';
				nodeParameters['fadeDuration'] = 900;

				await expect(node.execute.apply(executeStub)).rejects.toThrow('Invalid fade duration');
				expect(commands()).toEqual([]);
			});
		});

		describe('Audio clips', () => {
			it('Sends the clip to each listed player only, without grouping them', async () => {
				nodeParameters['action'] = 'playAudioClip';
				nodeParameters['targets'] = ['RINCON_KITCHEN', 'Living Room', 'RINCON_OFFICE'];
				nodeParameters['url'] = 'https://example.com/doorbell.mp3';
				nodeParameters['volume'] = 50;

				const result = await node.execute.apply(executeStub);

				expect(commands().map((call) => call.uri)).toEqual([
					api('players/RINCON_KITCHEN/audioClip'),
					api('players/RINCON_LIVING/audioClip'),
					api('players/RINCON_OFFICE/audioClip'),
				]);
				expect(commands()[0].body).toMatchObject({
					streamUrl: 'https://example.com/doorbell.mp3',
					volume: 50,
				});
				expect(result[0][0].json.players).toEqual(['Kitchen', 'Living Room', 'Office']);
			});

			it('Plays the clip at a different volume on each player', async () => {
				nodeParameters['action'] = 'playAudioClip';
				nodeParameters['targets'] = 'Kitchen, Office';
				nodeParameters['url'] = 'https://example.com/clip.mp3';
				nodeParameters['volume'] = '35, 50';

				const result = await node.execute.apply(executeStub);

				expect(commands().map((call) => [call.uri, call.body.volume])).toEqual([
					[api('players/RINCON_KITCHEN/audioClip'), 35],
					[api('players/RINCON_OFFICE/audioClip'), 50],
				]);
				expect(result[0][0].json.volume).toEqual([35, 50]);
			});

			it('Rejects a clip volume list that does not match the players', async () => {
				nodeParameters['action'] = 'playAudioClip';
				nodeParameters['targets'] = 'Kitchen, Office';
				nodeParameters['url'] = 'https://example.com/clip.mp3';
				nodeParameters['volume'] = '35, 50, 20';

				await expect(node.execute.apply(executeStub)).rejects.toThrow('2 volumes');
				expect(commands()).toEqual([]);
			});

			it('Accepts a comma-separated list of player names', async () => {
				nodeParameters['action'] = 'playAudioClip';
				nodeParameters['targets'] = 'Dining Room, Living Room';
				nodeParameters['url'] = 'https://example.com/clip.mp3';
				nodeParameters['volume'] = 50;

				await node.execute.apply(executeStub);

				expect(commands().map((call) => call.uri)).toEqual([
					api('players/RINCON_DINING/audioClip'),
					api('players/RINCON_LIVING/audioClip'),
				]);
			});

			it('Sends the clip to every player of a group given by its name', async () => {
				nodeParameters['action'] = 'playAudioClip';
				nodeParameters['targets'] = 'Living Room + 1';
				nodeParameters['url'] = 'https://example.com/clip.mp3';
				nodeParameters['volume'] = 50;

				await node.execute.apply(executeStub);

				expect(commands().map((call) => call.uri)).toEqual([
					api('players/RINCON_LIVING/audioClip'),
					api('players/RINCON_DINING/audioClip'),
				]);
			});
		});

		it('Processes every incoming item', async () => {
			const rows = [
				{ cible: 'Kitchen', volume: '14' },
				{ cible: 'Living Room, Dining Room', volume: '20, 10' },
				{ cible: 'Office', volume: 20 },
			];
			inputItems = rows.map((row) => ({ json: row }));
			nodeParameters['action'] = 'groupVolume';
			nodeParameters['players'] = ((i: number) => rows[i].cible) as any;
			nodeParameters['volume'] = ((i: number) => rows[i].volume) as any;

			const result = await node.execute.apply(executeStub);

			expect(result[0].length).toEqual(3);
			expect(volumeCalls()).toEqual([
				['RINCON_KITCHEN', 14],
				['RINCON_LIVING', 20],
				['RINCON_DINING', 10],
				['RINCON_OFFICE', 20],
			]);
			expect(result[0].map((item) => item.pairedItem)).toEqual([
				{ item: 0 },
				{ item: 1 },
				{ item: 2 },
			]);
		});
	});
});
