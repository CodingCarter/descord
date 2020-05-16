import {
  connectWebSocket,
  isWebSocketCloseEvent
} from 'https://deno.land/std/ws/mod.ts';
import { green, red, yellow } from 'https://deno.land/std/fmt/colors.ts';
import { HTTPError } from './errors/error.ts';
import { Collection } from './utils/util.ts';
import { Guild, ClientUser, Shard } from './models/model.ts';
import { Presence } from './interfaces/interface.ts';

class Client {
  #eventHandler: Map<string, (...params: any[]) => void>;
  #httpBase: string;
  #wsBase: string;
  #token?: string;
  #guilds: Collection<string, Guild>;
  #user?: ClientUser;
  #clientId?: string;
  #shardCount: number;
  #retries: number;

  shardManager: Collection<number, Shard>;
  owners: string[];

  constructor() {
    this.#eventHandler = new Map();
    this.#httpBase = 'https://discord.com/api/v6';
    this.#wsBase = '';
    this.#shardCount = 1;
    this.#retries = 3;
    this.#guilds = new Collection();

    this.shardManager = new Collection();
    this.owners = [];
  }

  addEventListener(event: string, handler: (...params: any[]) => void) {
    if (this.#eventHandler.get(event))
      throw `Event handler already set for event: ${event}. Only one handler per event is allowed`;
    else this.#eventHandler.set(event, handler);
  }

  on(event: string, handler: (...params: any[]) => void) {
    this.addEventListener(event, handler);
  }

  get token() {
    return this.#token!;
  }

  get user() {
    return this.#user!;
  }

  get clientId() {
    return this.#clientId!;
  }

  get guilds() {
    return this.#guilds;
  }

  emit(event: string, ...params: any[]) {
    if (this.#eventHandler.get(event))
      this.#eventHandler.get(event)!(...params);
  }

  async login(
    token: string,
    options: { presence: Presence } = {
      presence: { status: 'online', afk: false }
    }
  ) {
    try {
      this.#clientId = atob(token.split('.')[0]);

      this.emit('debug', yellow('Getting gateway info.'));
      let gatewayResponse = await fetch(`${this.#httpBase}/gateway/bot`, {
        method: 'GET',
        headers: { Authorization: `Bot ${token}` }
      });
      if (gatewayResponse.status !== 200) {
        throw new HTTPError(gatewayResponse).stack;
      }
      let gateway = await gatewayResponse.json();
      this.emit('debug', green('Gateway info successfully fetched.'));
      this.#token = token;
      this.#wsBase = gateway.url + '?v=6&encoding=6';
      this.#shardCount = gateway.shards;

      this.emit('debug', yellow('Trying to connect to discord ws servers.'));
      for (let i = 0; i < this.#shardCount; i++) {
        let newShard = new Shard(
          this,
          { shardId: i, total: this.#shardCount },
          this.#wsBase,
          options.presence
        );
        newShard.on('ready', (rawData) => {
          this.#user = new ClientUser(this, rawData['user']);
          rawData.guilds.forEach((guild: any) => {
            this.guilds.set(guild.id, new Guild(this, guild));
          });
          if (newShard.id === 0) this.emit('ready');
        });
        this.shardManager.set(i, newShard);
      }
    } catch (err) {
      console.error(err);
    }
  }
}

export default Client;