.PHONY: test up down restart logs clean e2e-small

test:
	docker build -f Dockerfile.test -t andx-unit-tests .
	docker run --rm andx-unit-tests

up:
	docker compose up -d --build

down:
	docker compose down

restart:
	docker compose down
	docker compose up -d --build

logs:
	docker compose logs -f

clean:
	docker compose down -v
