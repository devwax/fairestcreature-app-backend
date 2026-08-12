<?php
/** Staging: add/edit customer address (Admin API). Prefer hosted Profile under new accounts. */
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

$default = isset($data['default']) ? true : false;

if (isset($data['address_id'])) {
	$payload = array(
		'customer_address' => array(
			'customer_id' => $data['customer_id'],
			'company' => $data['company'] ?? '',
			'address1' => $data['address1'] ?? '',
			'address2' => $data['address2'] ?? '',
			'city' => $data['city'] ?? '',
			'province' => $data['province'] ?? '',
			'phone' => $data['phone'] ?? '',
			'zip' => $data['zip'] ?? '',
			'last_name' => $data['last_name'] ?? '',
			'first_name' => $data['first_name'] ?? '',
			'country' => $data['country'] ?? '',
			'default' => $default,
		),
	);
	$endpoint = "/admin/api/{$apiVersion}/customers/{$data['customer_id']}/addresses/{$data['address_id']}.json";
	$method = 'PUT';
} else {
	$payload = array(
		'customer' => array(
			'id' => $data['customer_id'],
			'addresses' => array(
				array(
					'company' => $data['company'] ?? '',
					'address1' => $data['address1'] ?? '',
					'address2' => $data['address2'] ?? '',
					'city' => $data['city'] ?? '',
					'province' => $data['province'] ?? '',
					'phone' => $data['phone'] ?? '',
					'zip' => $data['zip'] ?? '',
					'last_name' => $data['last_name'] ?? '',
					'first_name' => $data['first_name'] ?? '',
					'country' => $data['country'] ?? '',
					'default' => $default,
				),
			),
		),
	);
	$endpoint = "/admin/api/{$apiVersion}/customers/{$data['customer_id']}.json";
	$method = 'PUT';
}

$response = shopify_call($token, $shop, $endpoint, $payload, $method);
$decoded = isset($response['response']) ? json_decode($response['response'], true) : null;

if (!$decoded) {
	fc_json(array('status' => false, 'data' => ''));
}
if (isset($decoded['errors'])) {
	fc_json(array('status' => false, 'data' => $decoded['errors']));
}
fc_json(array('status' => true, 'data' => ''));
