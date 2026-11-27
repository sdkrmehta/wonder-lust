// ==============================================================================
// WONDER-LUST PM2 ENTERPRISE CLUSTER CONFIGURATION (PRODUCTION)
// ==============================================================================

module.exports = {
	apps: [
		{
			name: "wonderlust-api",
			script: "server.js",
			instances: process.env.PM2_INSTANCES || "max",
			exec_mode: "cluster",
			watch: false,
			max_memory_restart: "500M",
			kill_timeout: 5000,
			wait_ready: true,
			listen_timeout: 10000,
			env: {
				NODE_ENV: "production",
				PORT: 8080,
			},
			env_staging: {
				NODE_ENV: "staging",
				PORT: 8080,
			},
			env_development: {
				NODE_ENV: "development",
				PORT: 8080,
			},
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
			error_file: "logs/pm2-error.log",
			out_file: "logs/pm2-out.log",
			combine_logs: true,
			merge_logs: true,
		},
	],
};
