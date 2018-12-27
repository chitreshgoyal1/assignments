# frozen_string_literal: true

def getBotPrincessInitialLocation(grid_size, grid)
  # Bot position - cordinates
  bot_x = bot_y = (grid_size / 2)
  bot_x = bot_y = nil unless grid[bot_x][bot_y] == 'm'

  # Princess is in corners only
  princess_x = princess_y = 0 if grid[0][0] == 'p'
  if grid[0][grid_size - 1] == 'p'
    princess_x = 0
    princess_y = grid_size - 1
  end
  if grid[grid_size - 1][0] == 'p'
    princess_x = grid_size - 1
    princess_y = 0
  end
  if grid[grid_size - 1][grid_size - 1] == 'p'
    princess_x = grid_size - 1
    princess_y = grid_size - 1
  end

  [bot_x, bot_y, princess_x, princess_y]
end

def checkMove(bot_x, bot_y, princess_x, princess_y)
  # Track next move
  return 'RIGHT'  if bot_y < princess_y
  return 'LEFT'   if bot_y > princess_y
  return 'DOWN'   if bot_x < princess_x
  return 'UP'     if bot_x > princess_x
end

def nextMove(bot_x, bot_y, princess_x, princess_y)
  # Print move output
  puts move = checkMove(bot_x, bot_y, princess_x, princess_y)

  # Update bot position to next step
  bot_x -= 1 if move == 'UP'
  bot_x += 1 if move == 'DOWN'
  bot_y -= 1 if move == 'LEFT'
  bot_y += 1 if move == 'RIGHT'

  # Recursive call untill bot and princess together
  nextMove(bot_x, bot_y, princess_x, princess_y) unless bot_x == princess_x && bot_y == princess_y

  nil
end

def displayPathtoPrincess(grid_size, grid)
  if grid_size < 3 || grid_size > 100 || grid_size.even?
    puts "Game Lost: #{grid_size} is not a valid number"
    puts 'N should be lies between 3 to 100 (3<=N<100)'
    puts 'And should be a odd number'
    return
  end

  # get x, y cordinates of bot and princess
  bot_x, bot_y, princess_x, princess_y = getBotPrincessInitialLocation(grid_size, grid)

  return puts 'Princess not found in grid corners'  if princess_x.nil?
  return puts 'Bot not found in grid center'        if bot_x.nil?

  # Next move towards princess
  nextMove(bot_x, bot_y, princess_x, princess_y)
end

## Start here
# grid_size = length of grid
# grid = NxN matix
# in grid p denotes the princess and m denotes bot

grid_size = 5
grid = [['p', '-', '-', '-', '-'], ['-', '-', '-', '-', '-'], ['-', '-', 'm', '-', '-'], ['-', '-', '-', '-', '-'], ['-', '-', '-', '-', '-']]

# Rescue operation begins here
displayPathtoPrincess(grid_size, grid)
