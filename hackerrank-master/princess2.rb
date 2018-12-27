# frozen_string_literal: true

def checkMove(bot_x, bot_y, princess_X, princess_y)
  # Track next move
  return 'RIGHT'  if bot_y < princess_y
  return 'LEFT'   if bot_y > princess_y
  return 'DOWN'   if bot_x < princess_X
  return 'UP'     if bot_x > princess_X
end

def nextMove(grid_size, bot_x, bot_y, grid)
  # Get cordinates of princess
  grid.each_index do |row| col = grid[row].index 'p'; @princess = [row, col] if col end
  return puts 'Princess not found in grid' if @princess.nil?
  princess_x = @princess[0]
  princess_y = @princess[1]

  # Print move output
  puts move = checkMove(bot_x, bot_y, princess_x, princess_y)

  # To get next moves change bot position
  bot_x -= 1 if move == 'UP'
  bot_x += 1 if move == 'DOWN'
  bot_y -= 1 if move == 'LEFT'
  bot_y += 1 if move == 'RIGHT'

  # Recursive call untill bot and princess on same position
  nextMove(grid_size, bot_x, bot_y, grid) unless bot_x == princess_x && bot_y == princess_y
end

# Start here
# grid = the size of the board (NxN)
# *p denotes princess
# *m denotes bot
# predefined input
grid = [['-', 'p', '-', '', '-'],
        ['-', '-', '-', '-', '-'],
        ['-', '-', '-', '-', 'm'],
        ['', '-', '-', '-', '-'],
        ['-', '-', '-', '-', '-']]
grid_size = grid.length
grid.each_index do |row| col = grid[row].index 'm'; @rc = [row, col] if col end

if @rc.nil?
  puts 'Bot not found in grid'
else
  bot_x = @rc[0]
  bot_y = @rc[1]

  # Rescue operation begins here
  nextMove(grid_size, bot_x, bot_y, grid)
end
