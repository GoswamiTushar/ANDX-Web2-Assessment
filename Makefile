.PHONY: test up down restart logs clean

test:
	$(MAKE) -C project test

up:
	docker compose -f project/docker-compose.yml up -d --build

down:
	docker compose -f project/docker-compose.yml down

restart:
	docker compose -f project/docker-compose.yml down
	docker compose -f project/docker-compose.yml up -d --build

logs:
	docker compose -f project/docker-compose.yml logs -f

clean:
	docker compose -f project/docker-compose.yml down -v
