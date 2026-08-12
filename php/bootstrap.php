<?php

/**
 * Shared config + CORS for staging PHP endpoints.
 * Loads ../../.env from staging-bridge root.
 */

function fc_load_env($path) {
	if (!is_readable($path)) {
		return;
	}
	foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
		$line = trim($line);
		if ($line === '' || $line[0] === '#') {
			continue;
		}
		if (strpos($line, '=') === false) {
			continue;
		}
		list($key, $value) = explode('=', $line, 2);
		$key = trim($key);
		$value = trim($value, " \t\"'");
		if ($key !== '' && getenv($key) === false) {
			putenv("{$key}={$value}");
			$_ENV[$key] = $value;
		}
	}
}

fc_load_env(dirname(__DIR__) . '/.env');

function fc_config($key, $default = null) {
	$v = getenv($key);
	if ($v === false || $v === '') {
		return $default;
	}
	return $v;
}

function fc_apply_cors() {
	$allowed = array_filter(array_map('trim', explode(',', fc_config('CORS_ORIGINS', ''))));
	$origin = $_SERVER['HTTP_ORIGIN'] ?? '';

	if ($origin !== '' && in_array($origin, $allowed, true)) {
		header("Access-Control-Allow-Origin: {$origin}");
		header('Vary: Origin');
		header('Access-Control-Allow-Headers: source-url, Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With');
		header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
	}

	if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
		http_response_code(204);
		exit;
	}
}

function fc_json($payload) {
	header('Content-Type: application/json');
	echo json_encode($payload);
	exit;
}

function fc_parse_body() {
	$raw = file_get_contents('php://input');
	$parsed = array();
	parse_str($raw, $parsed);
	return $parsed;
}

require_once __DIR__ . '/shopifyapi/functions.php';
