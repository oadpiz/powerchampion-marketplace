import re
import unittest

from server.testsupport import BASE, ORIGIN, PortalCase


class RouteTableTests(PortalCase):
    def test_every_method_and_path_is_registered_once(self):
        pairs = [(route.path, method) for route in self.app.routes for method in (getattr(route, "methods", None) or ())]
        self.assertEqual(len(pairs), len(set(pairs)), [p for p in pairs if pairs.count(p) > 1])

    def test_every_admin_route_refuses_customers_and_anonymous_callers(self):
        customer = self.client()
        self.register(customer, "route-check@example.test")
        anonymous = self.client()
        checked = 0
        for route in self.app.routes:
            if not getattr(route, "path", "").startswith(BASE + "/admin"):
                continue
            path = re.sub(r"\{[^}]+\}", "x", route.path)
            for method in sorted(route.methods or ()):
                if method == "HEAD":
                    continue
                for client, status in ((customer, 403), (anonymous, 401)):
                    response = client.request(method, path, json={}, headers={"Origin": ORIGIN})
                    self.assertEqual(response.status_code, status, (method, route.path, response.text))
                checked += 1
        self.assertGreaterEqual(checked, 20)


if __name__ == "__main__":
    unittest.main()
