<?php
/** Staging: update name + phone (Admin API). Prefer hosted Profile under new accounts. */
require_once __DIR__ . '/bootstrap.php';
fc_apply_cors();

$shop = fc_config('SHOPIFY_SHOP');
$token = fc_config('SHOPIFY_ADMIN_TOKEN');
$apiVersion = fc_config('SHOPIFY_API_VERSION', '2024-10');

if (!$shop || !$token) {
	fc_json(array('status' => false, 'data' => 'Missing config'));
}

$data = fc_parse_body();
if (empty($data['customer_id'])) {
	fc_json(array('status' => false, 'data' => ''));
}

$payload = array(
	'customer' => array(
		'id' => $data['customer_id'],
		'first_name' => $data['first_name'] ?? '',
		'last_name' => $data['last_name'] ?? '',
		'phone' => $data['phone'] ?? '',
	),
);

$response = shopify_call(
	$token,
	$shop,
	"/admin/api/{$apiVersion}/customers/{$data['customer_id']}.json",
	$payload,
	'PUT'
);
$decoded = isset($response['response']) ? json_decode($response['response'], true) : null;

if (!$decoded) {
	fc_json(array('status' => false, 'data' => ''));
}
if (isset($decoded['errors'])) {
	fc_json(array('status' => false, 'data' => $decoded['errors']));
}
fc_json(array('status' => true, 'data' => ''));
