import { type FSWatcher, watch } from 'node:fs'
import { access, constants, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { type Document, parseDocument } from 'yaml'

type Duration = `${string}s` | `${string}h` | `${string}m` | `${string}d` | `${string}y`

type Config = {
	server_url: string;
	listen_addr: string;
	metrics_listen_addr: string;
	grpc_listen_addr: string;
	grpc_allow_insecure: boolean;

	private_key_path: string;
	noise: {
		private_key_path: string;
	};

	prefixes: {
		v4: string;
		v6: string;
	};

	derp: {
		server: {
			enabled: boolean;
			region_id: number;
			region_code: string;
			region_name: string;
			stun_listen_addr: string;
		};

		urls: string[];
		paths: string[];
		auto_update_enabled: boolean;
		update_frequency: Duration;
	};

	disable_check_updates: boolean;
	epheremal_node_inactivity_timeout: Duration;
	node_update_check_interval: Duration;

	// Database is probably dangerous
	database: {
		type: 'sqlite3' | 'sqlite' | 'postgres';
		sqlite?: {
			path: string;
		};

		postgres?: {
			host: string;
			port: number;
			name: string;
			user: string;
			pass: string;
			max_open_conns: number;
			max_idle_conns: number;
			conn_max_idle_time_secs: number;
			ssl: boolean;
		};
	};

	acme_url: string;
	acme_email: string;
	tls_letsencrypt_hostname: string;
	tls_letsencrypt_cache_dir: string;
	tls_letsencrypt_challenge_type: string;
	tls_letsencrypt_listen: string;
	tls_cert_path: string;
	tls_key_path: string;

	log: {
		format: 'text' | 'json';
		level: string;
	};

	acl_policy_path: string;
	dns_config: {
		override_local_dns: boolean;
		nameservers: string[];
		restricted_nameservers: Record<string, string[]>; // Split DNS
		domains: string[];
		extra_records: Array<{
			name: string;
			type: 'A';
			value: string;
		}>;

		magic_dns: boolean;
		base_domain: string;
	};

	unix_socket: string;
	unix_socket_permission: string;

	oidc: {
		only_start_if_oidc_is_available: boolean;
		issuer: string;
		client_id: string;
		client_secret: string;
		expiry: Duration;
		use_expiry_from_token: boolean;
		scope: string[];
		extra_params: Record<string, string>;

		allowed_domains: string[];
		allowed_groups: string[];
		allowed_users: string[];

		strip_email_domain: boolean;
	};

	logtail: {
		enabled: boolean;
	};

	randomize_client_port: boolean;
}

let config: Document

export async function getConfig(force = false) {
	if (!config || force) {
		const path = resolve(process.env.CONFIG_FILE ?? '/etc/headscale/config.yaml')
		const data = await readFile(path, 'utf8')
		config = parseDocument(data)
	}

	return config.toJSON() as Config
}

// This is so obscenely dangerous, please have a check around it
export async function patchConfig(partial: Record<string, unknown>) {
	for (const [key, value] of Object.entries(partial)) {
		config.setIn(key.split('.'), value)
	}

	const path = resolve(process.env.CONFIG_FILE ?? '/etc/headscale/config.yaml')
	await writeFile(path, config.toString(), 'utf8')
}

let watcher: FSWatcher

export function registerConfigWatcher() {
	if (watcher) {
		return
	}

	const path = resolve(process.env.CONFIG_FILE ?? '/etc/headscale/config.yaml')
	watcher = watch(path, async () => {
		console.log('Config file changed, reloading')
		await getConfig(true)
	})
}

type Context = {
	hasDockerSock: boolean;
	hasConfig: boolean;
	hasConfigWrite: boolean;
	hasAcl: boolean;
	hasAclWrite: boolean;
}

export let context: Context

export async function getContext() {
	if (!context) {
		context = {
			hasDockerSock: await checkSock(),
			hasConfig: await hasConfig(),
			hasConfigWrite: await hasConfigW(),
			hasAcl: await hasAcl(),
			hasAclWrite: await hasAclW()
		}
	}

	return context
}

async function checkSock() {
	try {
		await access('/var/run/docker.sock', constants.R_OK)
		return true
	} catch {}

	if (!process.env.HEADSCALE_CONTAINER) {
		return false
	}

	return false
}

async function hasConfig() {
	try {
		await getConfig()
		return true
	} catch {}

	return false
}

async function hasConfigW() {
	const path = resolve(process.env.CONFIG_FILE ?? '/etc/headscale/config.yaml')
	try {
		await access(path, constants.W_OK)
		return true
	} catch {}

	return false
}

async function hasAcl() {
	let path = process.env.ACL_FILE
	if (!path) {
		try {
			const config = await getConfig()
			path = config.acl_policy_path
		} catch {}

		return false
	}

	if (!path) {
		return false
	}

	try {
		path = resolve(path)
		await access(path, constants.R_OK)
		return true
	} catch {}

	return false
}

async function hasAclW() {
	let path = process.env.ACL_FILE
	if (!path) {
		try {
			const config = await getConfig()
			path = config.acl_policy_path
		} catch {}

		return false
	}

	if (!path) {
		return false
	}

	try {
		path = resolve(path)
		await access(path, constants.W_OK)
		return true
	} catch {}

	return false
}
