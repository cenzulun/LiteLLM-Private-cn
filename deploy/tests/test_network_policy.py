import socket
import unittest
from unittest.mock import patch

from realai_private.network import address_is_internal, endpoint_error, internal_socket_address
from realai_private.policy import model_write_error


class NetworkPolicyTests(unittest.TestCase):
    def test_decision_classifier_requires_registered_private_deployment(self):
        params = {"model": "auto_router/internal", "complexity_router_config": {"classifier_type": "jev"}}
        self.assertIsNotNone(model_write_error({"litellm_params": params}, creating=True))
        params["complexity_router_config"]["jev_classifier_config"] = {"deployment_name": "private-classifier"}
        self.assertIsNone(model_write_error({"litellm_params": params}, creating=True))

    def test_valid_network_addresses_are_accepted_without_range_classification(self):
        for address in ("10.1.2.3", "172.18.0.2", "192.168.1.8", "148.23.45.67", "8.8.8.8", "::1", "::ffff:10.1.2.3"):
            self.assertTrue(address_is_internal(address))
        self.assertFalse(address_is_internal("not a host"))

    def test_hostname_and_ip_are_passed_to_the_socket_unchanged(self):
        with socket.socket() as connection:
            self.assertEqual(internal_socket_address(connection, ("gateway.internal", 4000)), ("gateway.internal", 4000))
            self.assertEqual(internal_socket_address(connection, ("148.23.45.67", 4000)), ("148.23.45.67", 4000))

    def test_any_routable_ip_uses_the_same_url_validation(self):
        self.assertIsNone(endpoint_error("http://148.23.45.67:8000/v1"))
        self.assertIsNone(endpoint_error("http://10.0.0.3:8000/v1"))

    def test_invalid_addresses_are_configuration_errors(self):
        for value in (None, "", "file:///etc/passwd", "http://user:secret@10.0.0.2", "http://[bad", "http://10.0.0.1:bad"):
            self.assertIsNotNone(endpoint_error(value))

    def test_domestic_model_write_and_partial_update(self):
        self.assertIsNone(model_write_error({"litellm_params": {"model": "openai/Qwen3-235B", "api_base": "http://127.0.0.1:8000/v1"}}, creating=True))
        self.assertIsNone(model_write_error({"litellm_params": {"timeout": 120}}, creating=False))
        self.assertIsNone(model_write_error({"litellm_params": {"model": "openai/company-custom-model", "api_base": "http://127.0.0.1:8000/v1"}}, creating=True))
        self.assertIsNone(model_write_error({"litellm_params": {"model": "hosted_vllm/company-custom-model", "api_base": "http://127.0.0.1:8000/v1"}}, creating=True))
        self.assertIsNone(model_write_error({"litellm_params": {"model": "openai/Qwen3-235B", "api_base": "https://8.8.8.8/v1"}}, creating=True))


if __name__ == "__main__":
    unittest.main()
