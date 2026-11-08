![workflow](https://user-images.githubusercontent.com/8611608/204108531-22228164-e07b-41d0-a965-63f4cc55777d.png)

# n8n-nodes-sonos

This is the repository for the n8n sonos node.

## Setup

Prerequisite: You have to have an n8n node running. It can be either a cloud instance or a locally running instance in a docker container, e.g. on a Synology NAS.

### Add node to n8n

Add the n8n-nodes-sonos node to your n8n instance.
![ScreenRecording](https://user-images.githubusercontent.com/8611608/228347520-99a11490-9bfd-4e9b-be3b-c1b57532d4a0.gif)

### Setup Sonos Developer Account
In order to use the Sonos node, you have to create a Sonos Developer Account and create a new Control Integration. The created credentials will be required for the creation of the n8n credential.
![using-oauth](https://user-images.githubusercontent.com/8611608/204108609-140d3c9d-46a5-4009-bf88-275c711b45fe.gif)

In n8n create a new credential for the Sonos node and copy the redirect URL. Make sure you copy the correct redirect URI into the allowed redirect URIs of your Sonos integration in your developer account.

Afterwards you should be able to create workflows using the Sonos node.

## Features and possible use cases

Currently supported features:
* Play / Pause / Toggle Play/Pause / Skip Song / Previous Song on the selected players
* Play Favorite and Play Playlist (Sonos playlists) on the selected players, optionally setting the volume first
* Set Group Volume on the selected players
* Fade Duration on Pause, Set Group Volume, Play Favorite and Play Playlist: every player changes progressively, at the same time, to its own volume
* Play Audio Clip from a URL on each selected player (the music is lowered during the clip, then resumes)
* Group all players
* Turn On/Off TV (requires supported device)
* Start Home Theater Playback
* Set Home Theater Options (night mode / dialog enhancement)

### Players and grouping

The playback and volume actions have a "Players" field: the players that play together.
Before acting, the node makes sure they form exactly one group: if needed it regroups them,
players that are not listed leave the group and keep their own music. A speaker grouped by mistake in the Sonos app
is therefore separated again by the next action.

Play Audio Clip sends the clip to each selected player without grouping them.

Workflows made with the former "Group" field keep working: they act on the group containing that player
(or on the first group found when it is empty), without regrouping.

### Volumes

The Volume field accepts one volume for every player (`30`) or one volume per player, in the same order as the
Players field (`30, 30, 20`). Each player is set individually, so the differences between players are kept
even after a fade to 0.

### Expressions

When the fields are set with expressions (e.g. from a schedule table), the node accepts names:
* Players: a comma-separated list of player names or IDs (`Living Room, Dining Room`).
* Favorite / Playlist: the name as displayed in the Sonos app, or its ID.

Every incoming item is processed, and the output describes what was done (group, members, whether it was regrouped, volumes...).

Possible use cases
* Every day at 10pm set the home theater to night mode and enhance dialogs, every morning switch back
* Every morning at 9 turn on TV, start TV playback, group the players and set volume to 30
* If a webhook gets called stop/start the music
* If I receive money on my paypal business account, group all players, set the volume to 50 and play a file from a URL

## Running locally / Development

First install n8n globally
```bash
npm install n8n -g
```

Then build and link this library:
```bash
npm run build
npm link
```

Afterwards find out where n8n was installed
```bash
which n8n
```

Go to the folder that is listed and type:
```bash
npm link n8n-nodes-sonos
n8n start
```

Afterwards you can use the node in your locally running instance

## License

[MIT](https://github.com/VonRehbergConsulting/n8n-nodes-sonos/blob/master/LICENSE.md)
